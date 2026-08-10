"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, UserMinus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ErrorText } from "@/components/ui/error-text";
import { useGlobalStore, type Role } from "@/lib/store";
import { useCanManageUsers, useIsPlatformAdmin } from "@/hooks/useCanEdit";
import { roleBadgeVariant, roleLabel } from "@/lib/roles";
import { formatDate } from "@/lib/format";
import { apiFetch, ApiError } from "@/lib/api";

type Company = { id: string; name: string; created_at: string };
type Member = { user_id: string; email: string | null; company_id: string; role: Role; created_at: string };
type UserLookup = { user_id: string; email: string };

const ROLE_OPTIONS: Role[] = ["modelador", "visualizador", "admin_compania"];

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const detail = err.detail?.detail ?? err.detail;
    return typeof detail === "string" ? detail : err.message || fallback;
  }
  return fallback;
}

export default function AdminPage() {
  const isPlatformAdmin = useIsPlatformAdmin();
  const canManageUsers = useCanManageUsers();
  const activeCompanyId = useGlobalStore((s) => s.activeCompanyId);
  const memberships = useGlobalStore((s) => s.memberships);
  const activeCompanyName = memberships.find((m) => m.companyId === activeCompanyId)?.companyName ?? "";

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Administración</h1>
        <p className="text-sm text-[var(--color-muted)]">Gestión de compañías y miembros de la plataforma.</p>
      </header>

      {!isPlatformAdmin && !canManageUsers && (
        <Card>
          <p className="text-sm text-[var(--color-muted)]">
            No tienes permisos de administración en la compañía activa. Esta sección requiere ser platform admin
            o tener el rol Admin en una compañía.
          </p>
        </Card>
      )}

      {isPlatformAdmin && <CompaniesPanel />}

      {canManageUsers && activeCompanyId && <MembersPanel companyId={activeCompanyId} companyName={activeCompanyName} />}
    </section>
  );
}

function CompaniesPanel() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<Company | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);

  const fetchCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiFetch<Company[]>("/admin/companies", { skipCompanyHeader: true });
      setCompanies(rows);
    } catch (err) {
      toast.error(errorMessage(err, "No se pudieron cargar las compañías"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <CardHeader title="Compañías" subtitle="Crear y administrar compañías de la plataforma" />
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 inline h-4 w-4" /> Nueva compañía
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">Cargando…</p>
      ) : companies.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">Todavía no hay compañías.</p>
      ) : (
        <div className="space-y-2">
          {companies.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-xl border border-[var(--color-border)] px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium">{c.name}</p>
                <p className="text-xs text-[var(--color-muted)]">Creada {formatDate(c.created_at)}</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  aria-label="Renombrar compañía"
                  className="rounded-full p-2 hover:bg-[var(--color-accent-soft)]"
                  onClick={() => setRenameTarget(c)}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  aria-label="Eliminar compañía"
                  className="rounded-full p-2 text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
                  onClick={() => setDeleteTarget(c)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateCompanyModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(company) => setCompanies((prev) => [company, ...prev])}
      />
      <RenameCompanyModal
        company={renameTarget}
        onClose={() => setRenameTarget(null)}
        onRenamed={(company) => setCompanies((prev) => prev.map((c) => (c.id === company.id ? company : c)))}
      />
      <DeleteCompanyModal
        company={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={(id) => setCompanies((prev) => prev.filter((c) => c.id !== id))}
      />
    </Card>
  );
}

function CreateCompanyModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (company: Company) => void;
}) {
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setAdminEmail("");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!name.trim() || !adminEmail.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const lookup = await apiFetch<UserLookup>(`/admin/users/lookup?email=${encodeURIComponent(adminEmail.trim())}`, {
        skipCompanyHeader: true,
      });
      const company = await apiFetch<Company>("/admin/companies", {
        method: "POST",
        skipCompanyHeader: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), admin_user_id: lookup.user_id }),
      });
      toast.success(`Compañía "${company.name}" creada`);
      onCreated(company);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError("No existe ningún usuario registrado con ese email. Debe crear su cuenta primero.");
      } else {
        setError(errorMessage(err, "No se pudo crear la compañía"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Nueva compañía">
      <div className="space-y-4">
        <div>
          <Eyebrow>Nombre</Eyebrow>
          <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" />
        </div>
        <div>
          <Eyebrow>Email del primer admin</Eyebrow>
          <Input
            className="mt-1"
            type="email"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            placeholder="admin@empresa.com"
          />
        </div>
        {error && <ErrorText className="text-sm">{error}</ErrorText>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim() || !adminEmail.trim()}>
            {submitting ? "Creando…" : "Crear"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RenameCompanyModal({
  company,
  onClose,
  onRenamed,
}: {
  company: Company | null;
  onClose: () => void;
  onRenamed: (company: Company) => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (company) {
      setName(company.name);
      setError(null);
    }
  }, [company]);

  const handleSubmit = async () => {
    if (!company || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiFetch<Company>(`/admin/companies/${company.id}`, {
        method: "PATCH",
        skipCompanyHeader: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      toast.success("Compañía renombrada");
      onRenamed(updated);
      onClose();
    } catch (err) {
      setError(errorMessage(err, "No se pudo renombrar la compañía"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={!!company} onClose={onClose} title="Renombrar compañía">
      <div className="space-y-4">
        <div>
          <Eyebrow>Nombre</Eyebrow>
          <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {error && <ErrorText className="text-sm">{error}</ErrorText>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim()}>
            {submitting ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DeleteCompanyModal({
  company,
  onClose,
  onDeleted,
}: {
  company: Company | null;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (company) setError(null);
  }, [company]);

  const handleDelete = async () => {
    if (!company) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/admin/companies/${company.id}`, { method: "DELETE", skipCompanyHeader: true });
      toast.success(`Compañía "${company.name}" eliminada`);
      onDeleted(company.id);
      onClose();
    } catch (err) {
      setError(errorMessage(err, "No se pudo eliminar la compañía"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={!!company} onClose={onClose} title="Eliminar compañía">
      <div className="space-y-4">
        <p className="text-sm">
          ¿Eliminar <span className="font-medium">{company?.name}</span>? Esta acción no se puede deshacer.
        </p>
        {error && <ErrorText className="text-sm">{error}</ErrorText>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={submitting}>
            {submitting ? "Eliminando…" : "Eliminar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function MembersPanel({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await apiFetch<Member[]>(`/admin/companies/${companyId}/members`);
      setMembers(rows);
    } catch (err) {
      toast.error(errorMessage(err, "No se pudieron cargar los miembros"));
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleRoleChange = async (member: Member, role: Role) => {
    const previous = members;
    setMembers((prev) => prev.map((m) => (m.user_id === member.user_id ? { ...m, role } : m)));
    try {
      await apiFetch<Member>(`/admin/companies/${companyId}/members/${member.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      toast.success("Rol actualizado");
    } catch (err) {
      setMembers(previous);
      toast.error(errorMessage(err, "No se pudo actualizar el rol"));
    }
  };

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between">
        <CardHeader title="Miembros" subtitle={companyName ? `Compañía activa: ${companyName}` : undefined} />
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 inline h-4 w-4" /> Agregar miembro
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-[var(--color-muted)]">Cargando…</p>
      ) : members.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">Todavía no hay miembros.</p>
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <div
              key={m.user_id}
              className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{m.email ?? m.user_id}</p>
                <p className="text-xs text-[var(--color-muted)]">Desde {formatDate(m.created_at)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  wrapperClassName="w-40"
                  value={m.role}
                  onChange={(e) => handleRoleChange(m, e.target.value as Role)}
                >
                  {ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {roleLabel(role)}
                    </option>
                  ))}
                </Select>
                <Badge variant={roleBadgeVariant(m.role)}>{roleLabel(m.role)}</Badge>
                <button
                  aria-label="Remover miembro"
                  className="rounded-full p-2 text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
                  onClick={() => setRemoveTarget(m)}
                >
                  <UserMinus className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AddMemberModal
        open={addOpen}
        companyId={companyId}
        onClose={() => setAddOpen(false)}
        onAdded={(member) => setMembers((prev) => [member, ...prev])}
      />
      <RemoveMemberModal
        companyId={companyId}
        member={removeTarget}
        onClose={() => setRemoveTarget(null)}
        onRemoved={(userId) => setMembers((prev) => prev.filter((m) => m.user_id !== userId))}
      />
    </Card>
  );
}

function AddMemberModal({
  open,
  companyId,
  onClose,
  onAdded,
}: {
  open: boolean;
  companyId: string;
  onClose: () => void;
  onAdded: (member: Member) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("visualizador");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setEmail("");
      setRole("visualizador");
      setError(null);
    }
  }, [open]);

  const handleSubmit = async () => {
    if (!email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const lookup = await apiFetch<UserLookup>(`/admin/users/lookup?email=${encodeURIComponent(email.trim())}`, {
        skipCompanyHeader: true,
      });
      const member = await apiFetch<Member>(`/admin/companies/${companyId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: lookup.user_id, role }),
      });
      toast.success(`${member.email ?? "Miembro"} agregado`);
      onAdded(member);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError("No existe ningún usuario registrado con ese email. Debe crear su cuenta primero.");
      } else if (err instanceof ApiError && err.status === 409) {
        setError("Ese usuario ya es miembro de esta compañía.");
      } else {
        setError(errorMessage(err, "No se pudo agregar al miembro"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Agregar miembro">
      <div className="space-y-4">
        <div>
          <Eyebrow>Email</Eyebrow>
          <Input
            className="mt-1"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="persona@empresa.com"
          />
        </div>
        <div>
          <Eyebrow>Rol</Eyebrow>
          <Select className="mt-1" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </Select>
        </div>
        {error && <ErrorText className="text-sm">{error}</ErrorText>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !email.trim()}>
            {submitting ? "Agregando…" : "Agregar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RemoveMemberModal({
  companyId,
  member,
  onClose,
  onRemoved,
}: {
  companyId: string;
  member: Member | null;
  onClose: () => void;
  onRemoved: (userId: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (member) setError(null);
  }, [member]);

  const handleRemove = async () => {
    if (!member) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/admin/companies/${companyId}/members/${member.user_id}`, { method: "DELETE" });
      toast.success("Miembro removido");
      onRemoved(member.user_id);
      onClose();
    } catch (err) {
      setError(errorMessage(err, "No se pudo remover al miembro"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={!!member} onClose={onClose} title="Remover miembro">
      <div className="space-y-4">
        <p className="text-sm">
          ¿Remover a <span className="font-medium">{member?.email ?? member?.user_id}</span> de esta compañía?
        </p>
        {error && <ErrorText className="text-sm">{error}</ErrorText>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={handleRemove} disabled={submitting}>
            {submitting ? "Removiendo…" : "Remover"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
