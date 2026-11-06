"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    await authClient.signOut(); // deletes the session row and clears the cookie
    router.replace("/login");
    router.refresh(); // drop any server-rendered data cached for the logged-in user
  }

  return (
    <Button variant="ghost" size="sm" onClick={signOut} disabled={pending}>
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
