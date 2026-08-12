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

// good/warn/bad son estados (calidad de una métrica, resultado de una operación), nunca identidad
// — un rol no es un estado. Antes `visualizador` mapeaba a "warning", pintando de ámbar un rol
// perfectamente normal. Los tres roles usan el mismo tono neutro; el texto (roleLabel) los distingue.
export function roleBadgeVariant(_role: Role): "neutral" {
  return "neutral";
}
