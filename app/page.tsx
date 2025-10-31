import { FileText } from "lucide-react";
import { ChatInterface } from "@/components/ChatInterface"; // new client wrapper

export default function Page() {
  return (
    <div className="flex h-screen bg-background">
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary p-2">
              <FileText className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Legal Document Assistant</h1>
              <p className="text-sm text-muted-foreground">
                Upload, fill, and download your legal documents
              </p>
            </div>
          </div>
        </header>

        {/* Chat + Sidebar (handled client-side) */}
        <ChatInterface />
      </div>
    </div>
  );
}
