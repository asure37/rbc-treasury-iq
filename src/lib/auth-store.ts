import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type AuthStage = "login" | "welcome" | "dashboard";

interface AuthState {
  employeeId: string | null;
  firstName: string | null;
  stage: AuthStage;
  login: (employeeId: string, firstName: string) => void;
  advanceToDashboard: () => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      employeeId: null,
      firstName: null,
      stage: "login",
      login: (employeeId, firstName) => set({ employeeId, firstName, stage: "welcome" }),
      advanceToDashboard: () => set({ stage: "dashboard" }),
      logout: () => set({ employeeId: null, firstName: null, stage: "login" }),
    }),
    {
      name: "rbc-tiq-auth",
      storage: createJSONStorage(() => sessionStorage),
      skipHydration: true, // rehydrated manually on the client in AppGate to avoid SSR access to sessionStorage
      // Returning users who already reached the dashboard skip straight back in;
      // anyone still mid-welcome-animation on reload just re-lands on welcome.
      partialize: (state) => ({ employeeId: state.employeeId, firstName: state.firstName, stage: state.stage }),
    }
  )
);
