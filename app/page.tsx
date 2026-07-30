import { AtlasShell } from "@/components/atlas-shell";

export default function Home() {
  // Ohne record-Parameter waere die Graphansicht absichtlich leer. Die
  // Startseite fuehrt deshalb zuerst in den echten Katalog, von dem aus ein
  // quellengebundener Datensatz fuer die Visualisierung gewaehlt wird.
  return <AtlasShell initialView="library" />;
}
