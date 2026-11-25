export function isDeletedPractice(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "practice_record_deleted";
}

export function recordCreationQuery(createdAt?: string): string {
  return createdAt ? `?${new URLSearchParams({ created_at: createdAt })}` : "";
}
