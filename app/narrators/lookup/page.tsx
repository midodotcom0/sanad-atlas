import { Suspense } from "react";
import { NarratorLookup } from "@/components/research-record-layout";

export default function NarratorLookupPage() {
  return <Suspense fallback={null}><NarratorLookup /></Suspense>;
}
