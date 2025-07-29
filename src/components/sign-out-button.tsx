// file: src/components/sign-out-button.tsx
import { signOutAction } from "@/actions/auth-actions";
import { Button } from "./ui/button";

export function SignOutButton() {
    return (
        <form action={signOutAction}>
            <Button variant="outline" type="submit">Выйти</Button>
        </form>
    )
}
