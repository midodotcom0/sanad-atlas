import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource-variable/newsreader";
import "./globals.css";

export const metadata = {
  title: "Sanad Atlas — أطلس الإسناد",
  description: "Ein quellengebundener Wissensgraph für Isnād und Matn.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de" dir="ltr">
      <body>{children}</body>
    </html>
  );
}
