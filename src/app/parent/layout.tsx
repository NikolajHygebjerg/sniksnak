import ParentGuard from "./ParentGuard";

/**
 * Parent view layout.
 * Wraps all /parent/* routes: children cannot access; parents must enter code on /parent first.
 */
export default function ParentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ParentGuard>
      <div className="min-h-screen bg-gray-50 text-gray-900">
        {children}
      </div>
    </ParentGuard>
  );
}
