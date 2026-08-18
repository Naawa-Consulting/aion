import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Role = "modelador" | "visualizador" | "admin_compania";

export type Membership = {
  companyId: string;
  companyName: string;
  currencyCode: string;
  role: Role;
};

export type LongOperation = { active: boolean; label: string | null; progress: number | null };

type GlobalState = {
  datasetId: string | null;
  modelId: string | null;
  setDatasetId: (id: string | null) => void;
  setModelId: (id: string | null) => void;

  // Overlay central de proceso largo (Fase 8/Fase 2, G1) — deliberadamente NO persistido (ver
  // partialize abajo): un reload a medio proceso no debe resucitar un overlay bloqueado.
  longOperation: LongOperation;
  startLongOperation: (label: string) => void;
  updateLongOperationProgress: (progress: number | null) => void;
  endLongOperation: () => void;

  userId: string | null;
  userEmail: string | null;
  memberships: Membership[];
  isPlatformAdmin: boolean;
  // `memberships`/`isPlatformAdmin` aren't persisted (see `partialize` below), so every hard
  // reload starts this `true` until AuthBootstrap's /me/memberships fetch resolves. Pages that
  // gate on role (e.g. /admin's "no permissions" card) must check this first, or they flash the
  // wrong permission state for one render before the real memberships land.
  membershipsLoading: boolean;
  activeCompanyId: string | null;
  setSession: (user: { id: string; email: string | null } | null) => void;
  setMemberships: (memberships: Membership[], isPlatformAdmin: boolean) => void;
  setActiveCompanyId: (companyId: string | null) => void;
};

export const useGlobalStore = create<GlobalState>()(
  persist(
    (set) => ({
      datasetId: null,
      modelId: null,
      setDatasetId: (datasetId) => set({ datasetId }),
      setModelId: (modelId) => set({ modelId }),

      longOperation: { active: false, label: null, progress: null },
      startLongOperation: (label) => set({ longOperation: { active: true, label, progress: null } }),
      updateLongOperationProgress: (progress) =>
        set((state) => ({ longOperation: { ...state.longOperation, progress } })),
      endLongOperation: () => set({ longOperation: { active: false, label: null, progress: null } }),

      userId: null,
      userEmail: null,
      memberships: [],
      isPlatformAdmin: false,
      membershipsLoading: true,
      activeCompanyId: null,
      setSession: (user) =>
        set(
          user
            ? { userId: user.id, userEmail: user.email }
            : {
                userId: null,
                userEmail: null,
                memberships: [],
                isPlatformAdmin: false,
                membershipsLoading: true,
                activeCompanyId: null,
              }
        ),
      setMemberships: (memberships, isPlatformAdmin) =>
        set((state) => ({
          memberships,
          isPlatformAdmin,
          membershipsLoading: false,
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
      partialize: (state) => ({
        activeCompanyId: state.activeCompanyId,
        datasetId: state.datasetId,
        modelId: state.modelId,
      }),
    }
  )
);
