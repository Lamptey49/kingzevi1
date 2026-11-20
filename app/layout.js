import './globals.css';
import AppShell from './components/AppShell';
import { AuthProvider } from './context/AuthContext';

export const metadata = {
  title: 'King Zevi | Music Artist Platform',
  description: 'A modern music artist platform with fan community and streaming experiences.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
