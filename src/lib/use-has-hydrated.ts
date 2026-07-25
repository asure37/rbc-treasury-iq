import { useSyncExternalStore } from "react";
import { useAuthStore } from "@/lib/auth-store";

function subscribe(callback: () => void) {
  const unsub = useAuthStore.persist.onFinishHydration(callback);
  useAuthStore.persist.rehydrate();
  return unsub;
}

function getSnapshot() {
  return useAuthStore.persist.hasHydrated();
}

function getServerSnapshot() {
  return false;
}

// Subscribes to zustand's persist hydration status instead of tracking a
// local "mounted" flag, so there is no setState call inside an effect body.
export function useHasHydrated() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
