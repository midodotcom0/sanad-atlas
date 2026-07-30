import { Suspense } from "react";
import { RijalEntryRecord } from "@/components/research-record-layout";

export default function RijalEntryPage() {
  return <Suspense fallback={null}><RijalEntryRecord /></Suspense>;
}
