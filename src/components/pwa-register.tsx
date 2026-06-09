import { useEffect } from "react";
import { registerSW } from "virtual:pwa-register";

export function PWARegister() {
  useEffect(() => {
    registerSW({ immediate: true });
  }, []);

  return null;
}
