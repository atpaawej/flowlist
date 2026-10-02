import { SignIn } from "@clerk/nextjs";
import { AuthShell } from "../../auth-shell";

export default function SignInPage() {
  return (
    <AuthShell
      title="Sign in"
      description="Pick up where you left off."
    >
      <SignIn
        path="/sign-in"
        routing="path"
        fallbackRedirectUrl="/dashboard"
        signUpUrl="/sign-up"
      />
    </AuthShell>
  );
}