import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource-variable/newsreader";
import "./globals.css";

export const metadata = {
  title: "أطلس الإسناد — شبكة السنة الموثقة",
  description: "رسم معرفي موثق للأسانيد، والرواة، واختلاف المتون.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
