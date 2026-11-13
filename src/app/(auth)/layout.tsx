import { LegalFooter } from "@/components/LegalFooter";

/** Sign in, sign up and password pages, with the legal links and support contacts underneath. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="auth-page">{children}<LegalFooter /></div>;
}
