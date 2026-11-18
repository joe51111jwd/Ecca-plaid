import { afterEach, describe, expect, it } from "vitest";
import { assertSafeWebhookUrl, classifyAddress, setWebhookResolverForTests, type ResolvedAddress, type Resolver } from "./ssrf";

/** Fake DNS: host name → answers. Unknown names fail like NXDOMAIN. Addresses are documentation/synthetic values. */
function fakeDns(records: Record<string, string[]>): Resolver & { calls: string[] } {
  const calls: string[] = [];
  const resolver = async (hostname: string): Promise<ResolvedAddress[]> => {
    calls.push(hostname);
    const answers = records[hostname];
    if (!answers) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    return answers.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };
  return Object.assign(resolver, { calls });
}

const PUBLIC_V4 = "93.184.216.34";
const PUBLIC_V6 = "2606:2800:220:1:248:1893:25c8:1946";

const rejects = async (url: string, opts: Parameters<typeof assertSafeWebhookUrl>[1], message: RegExp) => {
  await expect(assertSafeWebhookUrl(url, opts), url).rejects.toMatchObject({ code: "validation_failed", message: expect.stringMatching(message) });
};

afterEach(() => setWebhookResolverForTests(null));

describe("classifyAddress", () => {
  it("recognizes every non-public range", () => {
    const cases: Array<[string, ReturnType<typeof classifyAddress>]> = [
      ["127.0.0.1", "loopback"],
      ["127.255.255.254", "loopback"],
      ["::1", "loopback"],
      ["10.0.0.1", "private"],
      ["10.255.255.255", "private"],
      ["172.16.0.1", "private"],
      ["172.31.255.255", "private"],
      ["192.168.1.1", "private"],
      ["fc00::1", "private"],
      ["fd12:3456:789a::1", "private"],
      ["fec0::1", "private"],
      ["169.254.0.1", "link_local"],
      ["fe80::1", "link_local"],
      ["100.64.0.1", "cgnat"],
      ["100.127.255.255", "cgnat"],
      ["169.254.169.254", "metadata"],
      ["100.100.100.200", "metadata"],
      ["168.63.129.16", "metadata"],
      ["fd00:ec2::254", "metadata"],
      ["0.0.0.0", "unspecified"],
      ["0.1.2.3", "unspecified"],
      ["::", "unspecified"],
      ["224.0.0.1", "multicast"],
      ["239.255.255.255", "multicast"],
      ["ff02::1", "multicast"],
      ["192.0.0.1", "reserved"],
      ["192.0.2.10", "reserved"],
      ["192.88.99.1", "reserved"],
      ["198.18.0.1", "reserved"],
      ["198.19.255.255", "reserved"],
      ["198.51.100.7", "reserved"],
      ["203.0.113.9", "reserved"],
      ["240.0.0.1", "reserved"],
      ["255.255.255.255", "reserved"],
      ["2001:db8::1", "reserved"],
      ["2001::1", "reserved"],
      ["2002:7f00:1::1", "reserved"],
      ["64:ff9b::7f00:1", "reserved"],
      ["100::1", "reserved"],
      ["3fff::1", "reserved"],
      ["4000::1", "reserved"],
      ["::2", "reserved"],
      ["not-an-ip", "reserved"],
      ["", "reserved"],
    ];
    for (const [address, expected] of cases) expect(classifyAddress(address), address).toBe(expected);
  });

  it("looks through IPv4-mapped IPv6 addresses", () => {
    expect(classifyAddress("::ffff:127.0.0.1")).toBe("loopback");
    expect(classifyAddress("::ffff:7f00:1")).toBe("loopback");
    expect(classifyAddress("0:0:0:0:0:ffff:7f00:1")).toBe("loopback");
    expect(classifyAddress("::ffff:10.1.2.3")).toBe("private");
    expect(classifyAddress("::ffff:a9fe:a9fe")).toBe("metadata");
    expect(classifyAddress("::ffff:192.168.0.1")).toBe("private");
    expect(classifyAddress(`::ffff:${PUBLIC_V4}`)).toBe("public");
    expect(classifyAddress("::ffff:5db8:d822")).toBe("public");
  });

  it("treats ordinary internet addresses as public, including the neighbours of blocked ranges", () => {
    for (const address of [PUBLIC_V4, "8.8.8.8", "1.1.1.1", "9.255.255.255", "11.0.0.0", "172.15.255.255", "172.32.0.0", "192.167.255.255", "192.169.0.0", "100.63.255.255", "100.128.0.0", "169.253.255.255", "169.255.0.0", "126.255.255.255", "128.0.0.0", "223.255.255.255", PUBLIC_V6, "2001:4860:4860::8888", "2001:200::1", "2a00:1450::1"]) {
      expect(classifyAddress(address), address).toBe("public");
    }
  });
});

describe("assertSafeWebhookUrl", () => {
  const dns = () =>
    fakeDns({
      "receiver.example": [PUBLIC_V4],
      "dual.example": [PUBLIC_V4, PUBLIC_V6],
      "internal.example": ["10.0.0.5"],
      "loop.example": ["127.0.0.1"],
      "metadata.example": ["169.254.169.254"],
      "cgnat.example": ["100.64.1.1"],
      "linklocal.example": ["fe80::1"],
      "ula.example": ["fd00::1"],
      "mapped.example": ["::ffff:10.0.0.5"],
      "mixed.example": [PUBLIC_V4, "192.168.1.20"],
      "empty.example": [],
      localhost: ["127.0.0.1"],
    });

  it("accepts a public https URL and returns the vetted addresses", async () => {
    const resolve = dns();
    expect(await assertSafeWebhookUrl("https://receiver.example/hooks/passport?x=1", { resolve, production: true })).toEqual({
      url: "https://receiver.example/hooks/passport?x=1",
      hostname: "receiver.example",
      addresses: [{ address: PUBLIC_V4, family: 4 }],
    });
    expect((await assertSafeWebhookUrl("https://dual.example:8443/", { resolve, production: true })).addresses).toEqual([
      { address: PUBLIC_V4, family: 4 },
      { address: PUBLIC_V6, family: 6 },
    ]);
    expect(resolve.calls).toEqual(["receiver.example", "dual.example"]);
  });

  it("accepts public IP literals without asking DNS", async () => {
    const resolve = dns();
    expect(await assertSafeWebhookUrl(`https://${PUBLIC_V4}/hook`, { resolve, production: true })).toMatchObject({ hostname: PUBLIC_V4, addresses: [{ address: PUBLIC_V4, family: 4 }] });
    expect(await assertSafeWebhookUrl(`https://[${PUBLIC_V6}]/hook`, { resolve, production: true })).toMatchObject({ hostname: PUBLIC_V6, addresses: [{ address: PUBLIC_V6, family: 6 }] });
    expect(resolve.calls).toEqual([]);
  });

  it("normalizes the URL: lower-cases the host and drops the fragment", async () => {
    const res = await assertSafeWebhookUrl("HTTPS://Receiver.Example/Hooks#section", { resolve: dns(), production: true });
    expect(res.url).toBe("https://receiver.example/Hooks");
  });

  it("rejects literal loopback, private, link-local, CGNAT, metadata and other non-public IPs", async () => {
    const cases: Array<[string, RegExp]> = [
      ["https://127.0.0.1/", /loopback/],
      ["https://127.8.9.10:8443/hook", /loopback/],
      ["https://[::1]/", /loopback/],
      ["https://10.0.0.1/", /private/],
      ["https://172.16.5.4/", /private/],
      ["https://192.168.0.10/", /private/],
      ["https://[fd00::1]/", /private/],
      ["https://169.254.10.10/", /link-local/],
      ["https://[fe80::1]/", /link-local/],
      ["https://100.64.0.1/", /carrier-grade NAT/],
      ["https://169.254.169.254/latest/meta-data/", /metadata/],
      ["https://[fd00:ec2::254]/", /metadata/],
      ["https://168.63.129.16/", /metadata/],
      ["https://0.0.0.0/", /unspecified/],
      ["https://[::]/", /unspecified/],
      ["https://224.0.0.1/", /multicast/],
      ["https://255.255.255.255/", /reserved/],
      ["https://192.0.2.1/", /reserved/],
      ["https://[64:ff9b::a00:1]/", /reserved/],
    ];
    for (const [url, message] of cases) await rejects(url, { resolve: dns(), production: true }, message);
  });

  it("is not fooled by alternative spellings of an internal address", async () => {
    const spellings = [
      "https://2130706433/", // decimal 127.0.0.1
      "https://0x7f000001/", // hex
      "https://0x7f.0.0.1/",
      "https://0177.0.0.1/", // octal
      "https://127.1/", // short form
      "https://127.0.1/",
      "https://[::ffff:127.0.0.1]/", // IPv4-mapped
      "https://[::ffff:7f00:1]/",
      "https://[0:0:0:0:0:ffff:7f00:1]/",
      "https://[0:0:0:0:0:0:0:1]/",
      "https://①②⑦.0.0.1/", // unicode digits, folded by IDNA
      "https://127.0.0.1./", // trailing dot
    ];
    for (const url of spellings) await rejects(url, { resolve: dns(), production: true }, /loopback/);
    await rejects("https://0xa9fea9fe/", { resolve: dns(), production: true }, /metadata/);
    await rejects("https://[::ffff:a9fe:a9fe]/", { resolve: dns(), production: true }, /metadata/);
    await rejects("https://0x0a000001/", { resolve: dns(), production: true }, /private/);
  });

  it("rejects host names that resolve to non-public addresses", async () => {
    const cases: Array<[string, RegExp]> = [
      ["https://internal.example/hook", /private/],
      ["https://loop.example/hook", /loopback/],
      ["https://metadata.example/hook", /metadata/],
      ["https://cgnat.example/hook", /carrier-grade NAT/],
      ["https://linklocal.example/hook", /link-local/],
      ["https://ula.example/hook", /private/],
      ["https://mapped.example/hook", /private/],
    ];
    for (const phase of ["register", "deliver"] as const) {
      for (const [url, message] of cases) await rejects(url, { resolve: dns(), production: true, phase }, message);
    }
  });

  it("rejects a host when any one of its addresses is non-public", async () => {
    await rejects("https://mixed.example/hook", { resolve: dns(), production: true }, /private/);
  });

  it("rejects hosts that do not exist or have no addresses", async () => {
    for (const phase of ["register", "deliver"] as const) {
      await rejects("https://nxdomain.example/hook", { resolve: dns(), production: true, phase }, /could not be resolved/);
      await rejects("https://empty.example/hook", { resolve: dns(), production: true, phase }, /could not be resolved/);
    }
  });

  it("accepts an unverifiable host at registration when DNS is temporarily unavailable, but never at delivery", async () => {
    const down: Resolver = async () => {
      throw Object.assign(new Error("getaddrinfo EAI_AGAIN"), { code: "EAI_AGAIN" });
    };
    expect(await assertSafeWebhookUrl("https://receiver.example/hook", { resolve: down, production: true, phase: "register" })).toEqual({
      url: "https://receiver.example/hook",
      hostname: "receiver.example",
      addresses: [],
    });
    await rejects("https://receiver.example/hook", { resolve: down, production: true, phase: "deliver" }, /could not be resolved/);
  });

  it("rejects schemes other than http(s), malformed URLs, credentials and oversized URLs", async () => {
    const opts = { resolve: dns(), production: false };
    for (const url of ["ftp://receiver.example/x", "file:///etc/passwd", "gopher://receiver.example/", "javascript:alert(1)", "data:text/plain,hi", "ws://receiver.example/", "//receiver.example/x"]) {
      await rejects(url, opts, /must start with https:\/\/|not a valid URL/);
    }
    for (const url of ["", "not a url", "https://", "receiver.example/hook"]) await rejects(url, opts, /not a valid URL|Enter the webhook URL|must start with/);
    // The URL parser reads this as host "path", which does not exist.
    await rejects("http:///path", opts, /could not be resolved/);
    await rejects("https://user:pass@receiver.example/hook", opts, /username or password/);
    await rejects("https://user@receiver.example/hook", opts, /username or password/);
    await rejects(`https://receiver.example/${"a".repeat(2048)}`, opts, /at most 2048/);
    await expect(assertSafeWebhookUrl(undefined as unknown as string, opts)).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("puts the reason on the url field for forms", async () => {
    await expect(assertSafeWebhookUrl("https://10.0.0.1/", { production: true })).rejects.toMatchObject({
      code: "validation_failed",
      details: { fields: { url: "The webhook URL points to a private network address, which is not allowed" } },
    });
  });

  describe("production", () => {
    it("requires https", async () => {
      await rejects("http://receiver.example/hook", { resolve: dns(), production: true }, /must use https/);
      await rejects(`http://${PUBLIC_V4}/hook`, { resolve: dns(), production: true }, /must use https/);
    });

    it("never allows localhost or loopback", async () => {
      await rejects("https://localhost/hook", { resolve: dns(), production: true }, /loopback/);
      await rejects("http://localhost:3000/hook", { resolve: dns(), production: true }, /must use https/);
      await rejects("https://127.0.0.1/hook", { resolve: dns(), production: true }, /loopback/);
      await rejects("https://[::1]/hook", { resolve: dns(), production: true }, /loopback/);
    });
  });

  describe("outside production", () => {
    it("allows http://localhost, 127.0.0.1 and [::1] for local receivers", async () => {
      const resolve = dns();
      expect(await assertSafeWebhookUrl("http://localhost:4000/hook", { resolve, production: false })).toEqual({
        url: "http://localhost:4000/hook",
        hostname: "localhost",
        addresses: [{ address: "127.0.0.1", family: 4 }],
      });
      expect((await assertSafeWebhookUrl("http://127.0.0.1:4000/hook", { resolve, production: false })).addresses).toEqual([{ address: "127.0.0.1", family: 4 }]);
      expect((await assertSafeWebhookUrl("http://[::1]:4000/hook", { resolve, production: false })).addresses).toEqual([{ address: "::1", family: 6 }]);
      expect((await assertSafeWebhookUrl("https://localhost/hook", { resolve, production: false })).hostname).toBe("localhost");
    });

    it("allows plain http to public hosts", async () => {
      expect((await assertSafeWebhookUrl("http://receiver.example/hook", { resolve: dns(), production: false })).addresses).toEqual([{ address: PUBLIC_V4, family: 4 }]);
    });

    it("still rejects every other internal target, including other loopback spellings and names", async () => {
      const opts = { resolve: dns(), production: false };
      await rejects("http://127.0.0.2/hook", opts, /loopback/);
      await rejects("http://loop.example/hook", opts, /loopback/);
      await rejects("http://localhost.:4000/hook", opts, /could not be resolved|loopback/);
      await rejects("http://10.0.0.1/hook", opts, /private/);
      await rejects("http://169.254.169.254/latest/meta-data/", opts, /metadata/);
      await rejects("http://internal.example/hook", opts, /private/);
      await rejects("http://[::ffff:10.0.0.1]/hook", opts, /private/);
      // "localhost" pointing somewhere internal that is not loopback gets no special treatment.
      await rejects("http://localhost/hook", { resolve: fakeDns({ localhost: ["10.0.0.9"] }), production: false }, /private/);
    });
  });

  it("uses the test resolver when one is installed and none is passed", async () => {
    const resolve = dns();
    setWebhookResolverForTests(resolve);
    await rejects("https://internal.example/hook", { production: true }, /private/);
    expect((await assertSafeWebhookUrl("https://receiver.example/hook", { production: true })).addresses).toEqual([{ address: PUBLIC_V4, family: 4 }]);
    expect(resolve.calls).toEqual(["internal.example", "receiver.example"]);
  });
});
