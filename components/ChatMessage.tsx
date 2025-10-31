import { Message } from "@/lib/types";
import { cn } from "@/lib/utils";
import { User, Bot } from "lucide-react";

interface ChatMessageProps {
  message: Message;
}

export const ChatMessage = ({ message }: ChatMessageProps) => {
  const isUser = message.role === 'user';
  
  return (
    <div
      className={cn(
        "flex gap-4 p-6 transition-colors",
        isUser ? "bg-background" : "bg-muted/30"
      )}
    >
      <div className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
        isUser 
          ? "bg-[hsl(var(--chat-user))] text-[hsl(var(--chat-user-foreground))]"
          : "bg-[hsl(var(--chat-assistant))] text-[hsl(var(--chat-assistant-foreground))]"
      )}>
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      
      <div className="flex-1 space-y-2">
        <p className="text-sm font-medium">
          {isUser ? 'You' : 'Legal Assistant'}
        </p>
        <div className="prose prose-sm max-w-none dark:prose-invert">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    </div>
  );
};
