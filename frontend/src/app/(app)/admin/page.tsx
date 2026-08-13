"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Trash2, UserMinus, Building2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ErrorText } from "@/components/ui/error-text";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableHeader, TableRow, Th, TableCell } from "@/components/ui/table";
import { RowActions } from "@/components/ui/row-actions";
import { IconButton } from "@/components/ui/icon-button";
import { useGlobalStore, type Role } from "@/lib/store";
import { useCanManageUsers, useIsPlatformAdmin } from "@/hooks/useCanEdit";
import { roleBadgeVariant, roleLabel } from "@/lib/roles";
import { formatDate } from "@/lib/format";
import { apiFetch, ApiError } from "@/lib/api";

type Company = { id: string; name: string; currency_code: string; created_at: string };
type Member = { user_id: string; email: string | null; company_id: string; role: Role; created_at: string };
type UserLookup = { user_id: string; email: string };

const ROLE_OPTIONS: Role[] = ["modelador", "visualizador", "admin_compania"];
const CURRENCY_OPTIONS = ["MXN", "USD", "EUR", "COP", "BRL", "ARS", "CLP", "GBP"];

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const detail = err.detail?.detail ?? err.detail;
    return typeof detail === "string" ? detail : err.message || fallback;
  }
  return fallback;
}

export default function AdminPage() {
  const t = useTranslations("admin");
  const isPlatformAdmin = useIsPlatformAdmin();
  const canManageUsers = useCanManageUsers();
  const activeCompanyId = useGlobalStore((s) => s.activeCompanyId);
  const memberships = useGlobalStore((s) => s.memberships);
  const membershipsLoading = useGlobalStore((s) => s.membershipsLoading);
  const activeCompanyName = memberships.find((m) => m.companyId === activeCompanyId)?.companyName ?? "";

  return (
    <section>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {membershipsLoading ? (
        <Card>
          <Skeleton className="h-6 w-48" />
        </Card>
      ) : (
        !isPlatformAdmin &&
        !canManageUsers && (
          <Card>
            <p className="text-sm text-muted">{t("noPermissions")}</p>
          </Card>
        )
      )}

      <div className="space-y-6">
        {isPlatformAdmin && <CompaniesPanel />}
        {canManageUsers && activeCompanyId && (
          <MembersPanel companyId={activeCompanyId} companyName={activeCompanyName} />
        )}
      </div>
    </section>
  );
}

function CompaniesPanel() {
  const t = useTranslations("admin");
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
      toast.error(errorMessage(err, t("errors.loadCompanies")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardHeader as="h2" title={t("companies.title")} subtitle={t("companies.subtitle")} />
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 inline h-4 w-4" /> {t("companies.new")}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : companies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={t("companies.emptyTitle")}
          description={t("companies.emptyDescription")}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <Th>{t("companies.columnName")}</Th>
              <Th>{t("companies.currencyLabel")}</Th>
              <Th>{t("companies.columnCreated")}</Th>
              <Th className="text-right">
                <span className="sr-only">{t("columnActions")}</span>
              </Th>
            </TableRow>
          </TableHeader>
          <tbody>
            {companies.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.name}</TableCell>
                <TableCell className="text-muted">{c.currency_code}</TableCell>
                <TableCell className="text-muted">{formatDate(c.created_at)}</TableCell>
                <TableCell>
                  <RowActions className="justify-end">
                    <IconButton
                      size="sm"
                      aria-label={t("companies.renameAria", { name: c.name })}
                      onClick={() => setRenameTarget(c)}
                    >
                      <Pencil className="h-4 w-4" />
                    </IconButton>
                    <IconButton
                      size="sm"
                      className="!text-bad hover:!bg-bad-bg"
                      aria-label={t("companies.deleteAria", { name: c.name })}
                      onClick={() => setDeleteTarget(c)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  </RowActions>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
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
  const t = useTranslations("admin");
  const [name, setName] = useState("");
  const [currencyCode, setCurrencyCode] = useState("MXN");
  const [adminEmail, setAdminEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setCurrencyCode("MXN");
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
        body: JSON.stringify({ name: name.trim(), admin_user_id: lookup.user_id, currency_code: currencyCode }),
      });
      toast.success(t("companies.created", { name: company.name }));
      onCreated(company);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError(t("errors.userNotFound"));
      } else {
        setError(errorMessage(err, t("errors.createCompany")));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("companies.newTitle")}>
      <div className="space-y-4">
        <div>
          <Eyebrow htmlFor="company-name">{t("companies.nameLabel")}</Eyebrow>
          <Input
            id="company-name"
            className="mt-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Corp"
          />
        </div>
        <div>
          <Eyebrow htmlFor="company-currency">{t("companies.currencyLabel")}</Eyebrow>
          <Select id="company-currency" className="mt-1" value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)}>
            {CURRENCY_OPTIONS.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Eyebrow htmlFor="company-admin-email">{t("companies.adminEmailLabel")}</Eyebrow>
          <Input
            id="company-admin-email"
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
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim() || !adminEmail.trim()}>
            {submitting ? t("companies.creating") : t("companies.create")}
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
  const t = useTranslations("admin");
  const [name, setName] = useState("");
  const [currencyCode, setCurrencyCode] = useState("MXN");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (company) {
      setName(company.name);
      setCurrencyCode(company.currency_code);
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
        body: JSON.stringify({ name: name.trim(), currency_code: currencyCode }),
      });
      toast.success(t("companies.renamed"));
      onRenamed(updated);
      onClose();
    } catch (err) {
      setError(errorMessage(err, t("errors.renameCompany")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={!!company} onClose={onClose} title={t("companies.renameTitle")}>
      <div className="space-y-4">
        <div>
          <Eyebrow htmlFor="company-rename">{t("companies.nameLabel")}</Eyebrow>
          <Input id="company-rename" className="mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Eyebrow htmlFor="company-rename-currency">{t("companies.currencyLabel")}</Eyebrow>
          <Select
            id="company-rename-currency"
            className="mt-1"
            value={currencyCode}
            onChange={(e) => setCurrencyCode(e.target.value)}
          >
            {CURRENCY_OPTIONS.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </div>
        {error && <ErrorText className="text-sm">{error}</ErrorText>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim()}>
            {submitting ? t("saving") : t("save")}
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
  const t = useTranslations("admin");
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
      toast.success(t("companies.deleted", { name: company.name }));
      onDeleted(company.id);
      onClose();
    } catch (err) {
      setError(errorMessage(err, t("errors.deleteCompany")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={!!company} onClose={onClose} title={t("companies.deleteTitle")}>
      <div className="space-y-4">
        <p className="text-sm text-ink">{t("companies.deleteConfirm", { name: company?.name ?? "" })}</p>
        {error && <ErrorText className="text-sm">{error}</ErrorText>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="danger" onClick={handleDelete} disabled={submitting}>
            {submitting ? t("deleting") : t("delete")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function MembersPanel({ companyId, companyName }: { companyId: string; companyName: string }) {
  const t = useTranslations("admin");
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
      toast.error(errorMessage(err, t("errors.loadMembers")));
    } finally {
      setLoading(false);
    }
  }, [companyId, t]);

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
      toast.success(t("members.roleUpdated"));
    } catch (err) {
      setMembers(previous);
      toast.error(errorMessage(err, t("errors.updateRole")));
    }
  };

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardHeader
          as="h2"
          title={t("members.title")}
          subtitle={companyName ? t("members.subtitle", { company: companyName }) : undefined}
        />
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 inline h-4 w-4" /> {t("members.add")}
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : members.length === 0 ? (
        <EmptyState icon={Users} title={t("members.emptyTitle")} description={t("members.emptyDescription")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <Th>{t("members.columnMember")}</Th>
              <Th>{t("members.columnRole")}</Th>
              <Th>{t("members.columnSince")}</Th>
              <Th className="text-right">
                <span className="sr-only">{t("columnActions")}</span>
              </Th>
            </TableRow>
          </TableHeader>
          <tbody>
            {members.map((m) => (
              <TableRow key={m.user_id}>
                <TableCell className="max-w-[220px] truncate font-medium">{m.email ?? m.user_id}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Select
                      wrapperClassName="w-40"
                      aria-label={t("members.roleSelectAria", { member: m.email ?? m.user_id })}
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
                  </div>
                </TableCell>
                <TableCell className="text-muted">{formatDate(m.created_at)}</TableCell>
                <TableCell>
                  <RowActions className="justify-end">
                    <IconButton
                      size="sm"
                      className="!text-bad hover:!bg-bad-bg"
                      aria-label={t("members.removeAria", { member: m.email ?? m.user_id })}
                      onClick={() => setRemoveTarget(m)}
                    >
                      <UserMinus className="h-4 w-4" />
                    </IconButton>
                  </RowActions>
                </TableCell>
              </TableRow>
            ))}
          </tbody>
        </Table>
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
  const t = useTranslations("admin");
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
      toast.success(t("members.added", { member: member.email ?? t("members.fallbackName") }));
      onAdded(member);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError(t("errors.userNotFound"));
      } else if (err instanceof ApiError && err.status === 409) {
        setError(t("errors.memberExists"));
      } else {
        setError(errorMessage(err, t("errors.addMember")));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={t("members.addTitle")}>
      <div className="space-y-4">
        <div>
          <Eyebrow htmlFor="member-email">{t("members.emailLabel")}</Eyebrow>
          <Input
            id="member-email"
            className="mt-1"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="persona@empresa.com"
          />
        </div>
        <div>
          <Eyebrow htmlFor="member-role">{t("members.columnRole")}</Eyebrow>
          <Select id="member-role" className="mt-1" value={role} onChange={(e) => setRole(e.target.value as Role)}>
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
            {t("cancel")}
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !email.trim()}>
            {submitting ? t("members.adding") : t("members.add")}
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
  const t = useTranslations("admin");
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
      toast.success(t("members.removed"));
      onRemoved(member.user_id);
      onClose();
    } catch (err) {
      setError(errorMessage(err, t("errors.removeMember")));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={!!member} onClose={onClose} title={t("members.removeTitle")}>
      <div className="space-y-4">
        <p className="text-sm text-ink">
          {t("members.removeConfirm", { member: member?.email ?? member?.user_id ?? "" })}
        </p>
        {error && <ErrorText className="text-sm">{error}</ErrorText>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="danger" onClick={handleRemove} disabled={submitting}>
            {submitting ? t("members.removing") : t("members.remove")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
