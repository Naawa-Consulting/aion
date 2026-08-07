import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Role = "modelador" | "visualizador" | "admin_compania";

export type Membership = {
  companyId: string;
  companyName: string;
  role: Role;
};

type GlobalState = {
  datasetId: string | null;
  modelId: string | null;
  setDatasetId: (id: string | null) => void;
  setModelId: (id: string | null) => void;

  userId: string | null;
  userEmail: string | null;
  memberships: Membership[];
  activeCompanyId: string | null;
  setSession: (user: { id: string; email: string | null } | null) => void;
  setMemberships: (memberships: Membership[]) => void;
  setActiveCompanyId: (companyId: string | null) => void;
};

export const useGlobalStore = create<GlobalState>()(
  persist(
    (set) => ({
      datasetId: null,
      modelId: null,
      setDatasetId: (datasetId) => set({ datasetId }),
      setModelId: (modelId) => set({ modelId }),

      userId: null,
      userEmail: null,
      memberships: [],
      activeCompanyId: null,
      setSession: (user) =>
        set(
          user
            ? { userId: user.id, userEmail: user.email }
            : { userId: null, userEmail: null, memberships: [], activeCompanyId: null }
        ),
      setMemberships: (memberships) =>
        set((state) => ({
          memberships,
          // Keep the current selection if it's still valid; otherwise default to the first membership.
          activeCompanyId: memberships.some((m) => m.companyId === state.activeCompanyId)
            ? state.activeCompanyId
            : memberships[0]?.companyId ?? null,
        })),
      // Switching company invalidates any dataset/model selected under the previous
      // company — otherwise stale ids keep getting sent with the new X-Company-Id and
      // the backend correctly (but confusingly) 404s them.
      setActiveCompanyId: (companyId) =>
        set({ activeCompanyId: companyId, datasetId: null, modelId: null }),
    }),
    {
      name: "aion-global-store",
      partialize: (state) => ({ activeCompanyId: state.activeCompanyId }),
    }
  )
);
