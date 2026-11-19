import { FlowLoading } from "@/features/intake/components/flow-loading";

/** Shown while a family screen is prepared (e.g. between the sign-in code and the permission screen). */
export default function Loading() {
  return <FlowLoading surface="page" />;
}
