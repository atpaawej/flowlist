import { SignUp } from "@clerk/nextjs";
import { AuthShell } from "../../auth-shell";

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      description="Takes about twenty seconds."
    >
      <SignUp
        path="/sign-up"
        routing="path"
        fallbackRedirectUrl="/dashboard"
        signInUrl="/sign-in"
      />
    </AuthShell>
  );
}