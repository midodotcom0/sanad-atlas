import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource-variable/newsreader";
import "./globals.css";

export const metadata = {
  title: "أطلس الإسناد — شبكة السنة الموثقة",
  description: "رسم معرفي موثق للأسانيد، والرواة، واختلاف المتون.",
};

/**
 * `dir="rtl"` ist der serverseitig gerenderte Ausgangswert und muss mit
 * `getServerSnapshot()` in `components/direction-context.tsx` uebereinstimmen,
 * damit die Hydration nicht abweicht. Der Umschalter (FR-10) setzt danach
 * `document.documentElement.dir` im Browser; die Inhaltssprache bleibt in jeder
 * Stellung Arabisch, weil nur die Leserichtung der Oberflaeche umgeschaltet
 * wird und nicht die Sprache der Quellen.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
