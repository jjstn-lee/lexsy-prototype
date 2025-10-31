"use client";

import { useState } from "react";
import { Message, DocumentState, Placeholder } from "@/lib/types";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { DocumentUpload } from "@/components/DocumentUpload";
import { DocumentPreview } from "@/components/DocumentPreview";
import { PlaceholderCard } from "@/components/PlaceholderCard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "assistant",
      content:
        "Hello! I'm your legal document assistant. Upload a document template to get started, and I'll guide you through filling in the required information.",
      timestamp: new Date(),
    },
  ]);
  const [document, setDocument] = useState<DocumentState | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentPlaceholder, setCurrentPlaceholder] = useState<Placeholder | null>(null);

  const handleUpload = async (file: File) => {
    setIsProcessing(true);
    
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to upload document");
      }

      const uploadedDoc: DocumentState = await response.json();
      
      // Convert date strings back to Date objects
      uploadedDoc.uploadedAt = new Date(uploadedDoc.uploadedAt);
      uploadedDoc.placeholders.forEach(p => {
        if (p.value) p.value = p.value;
      });

      console.log('[FRONTEND UPLOAD] Setting document with id:', uploadedDoc.id);

      // **Use uploadedDoc directly instead of reading from state**
      setDocument(uploadedDoc);

      const firstPlaceholder = uploadedDoc.placeholders.find(p => !p.filled) || null;
      setCurrentPlaceholder(firstPlaceholder);

      let initialMessage: string;
      if (uploadedDoc.placeholders.length === 0) {
        initialMessage = `I've analyzed "${file.name}". No placeholders were found in the document.`;
      } else {
        initialMessage = `I've analyzed "${file.name}". I found ${uploadedDoc.placeholders.length} placeholder${uploadedDoc.placeholders.length > 1 ? 's' : ''} that need to be filled.`;
        if (firstPlaceholder) {
          initialMessage += ` Let's start with ${firstPlaceholder.name}${firstPlaceholder.description ? ` - ${firstPlaceholder.description}` : ''}. What value would you like to use?`;
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: "assistant",
          content: initialMessage,
          timestamp: new Date(),
        },
      ]);

      toast.success("Document uploaded successfully!");
    } catch (error) {
      console.error("Upload error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to upload document");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendMessage = async (content: string) => {
    if (!document) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsProcessing(true);

    const sessionId = document.id;

    const requestBody = {
      sessionId: sessionId,
      message: content,
      currentPlaceholderId: currentPlaceholder?.id,
    };

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to process message");
      }

      const data = await response.json();

      // **Use functional state updates to avoid stale 'document'**
      if (data.isComplete) {
        setDocument((prev) => prev ? { ...prev, completed: true } : prev);
        toast.success("All placeholders filled! You can download the document.");
      }

      if (data.currentResponses) {
        setDocument((prev) => {
          if (!prev) return null;

          const updatedPlaceholders = prev.placeholders.map((placeholder) => {
            const responseValue = data.currentResponses[placeholder.id];
            if (responseValue !== undefined) {
              return { ...placeholder, value: responseValue, filled: true };
            }
            return placeholder;
          });

          // Update current placeholder to next unfilled one
          const nextUnfilled = updatedPlaceholders.find((p) => !p.filled) || null;
          setCurrentPlaceholder(nextUnfilled);

          return { ...prev, placeholders: updatedPlaceholders };
        });
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.message || data.assistantMessage || "",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);

    } catch (error) {
      console.error("Chat error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to process message");
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "I apologize, but I encountered an error processing your message. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!document || !document.completed) {
      toast.error("Document is not yet completed");
      return;
    }

    const sessionId = document.id;

    try {
      const response = await fetch(`/api/download/${sessionId}`);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to download document");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = document.fileName.replace(/\.docx?$/i, "") + "_completed.docx";
      window.document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      window.document.body.removeChild(a);

      toast.success("Document downloaded successfully!");
    } catch (error) {
      console.error("Download error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to download document");
    }
  };

  return (
    <div className="flex flex-1">
      {/* Left Panel (Chat) */}
      <div className="flex-1 flex flex-col">
        <ScrollArea className="flex-1">
          <div className="space-y-0">
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            {!document && !isProcessing && (
              <div className="p-6">
                <DocumentUpload onUpload={handleUpload} />
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input */}
        <div className="border-t p-4">
          <ChatInput
            onSend={handleSendMessage}
            disabled={isProcessing || !document}
            placeholder={document ? "Type your answer..." : "Upload a document to begin..."}
          />
        </div>
      </div>

      {/* Right Sidebar */}
      {document && (
        <>
          <Separator orientation="vertical" />
          <aside className="w-96 border-l">
            <ScrollArea className="h-full">
              <div className="p-6 space-y-6">
                <DocumentPreview document={document} onDownload={handleDownload} />

                <div className="space-y-3">
                  <h3 className="font-semibold">Placeholders</h3>
                  {document.placeholders.map((placeholder, index) => (
                    <PlaceholderCard 
                      key={placeholder.id ?? index} 
                      placeholder={placeholder}
                      isActive={currentPlaceholder?.id === placeholder.id}
                    />
                  ))}
                </div>
              </div>
            </ScrollArea>
          </aside>
        </>
      )}
    </div>
  );
}
