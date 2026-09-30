import { AppHeader } from "@/components/layout/AppHeader";
import { PdfWorkspace } from "@/features/pdf-editor/components/PdfWorkspace";

export default function Home() {
  return (
    <div className="min-h-screen bg-base-200">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl p-4 sm:p-6">
        <PdfWorkspace />
      </main>
    </div>
  );
}
