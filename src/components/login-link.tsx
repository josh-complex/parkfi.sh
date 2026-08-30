/**
 * A `/login` link that carries the current page as `?redirect=` so a
 * successful sign-in lands the user back where they started. Drop-in for
 * `<Link to="/login">`, including as a Base UI `render` element.
 */
import * as React from "react";
import { Link, useLocation } from "@tanstack/react-router";

export function LoginLink(props: Omit<React.ComponentProps<"a">, "href">) {
  const redirect = useLocation({ select: (l) => l.href });
  return <Link to="/login" search={{ redirect }} {...props} />;
}
