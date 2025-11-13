import { create } from "zustand";

type GlobalState = {
  datasetId: string | null;
  modelId: string | null;
  setDatasetId: (id: string | null) => void;
  setModelId: (id: string | null) => void;
};

export const useGlobalStore = create<GlobalState>((set) => ({
  datasetId: null,
  modelId: null,
  setDatasetId: (datasetId) => set({ datasetId }),
  setModelId: (modelId) => set({ modelId }),
}));

