import type { Role } from "./store";

export function roleLabel(role: Role): string {
  switch (role) {
    case "modelador":
      return "Modelador";
    case "admin_compania":
      return "Admin";
    case "visualizador":
    default:
      return "Visualizador";
  }
}

export function roleBadgeVariant(role: Role): "neutral" | "success" | "warning" {
  switch (role) {
    case "admin_compania":
      return "success";
    case "modelador":
      return "neutral";
    case "visualizador":
    default:
      return "warning";
  }
}
