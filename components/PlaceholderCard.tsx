import { Placeholder } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle } from "lucide-react";

interface PlaceholderCardProps {
  placeholder: Placeholder;
  isActive?: boolean;
}

export const PlaceholderCard = ({ placeholder, isActive = false }: PlaceholderCardProps) => {
  return (
    <Card className={`p-4 transition-all ${isActive ? 'ring-2 ring-primary' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {placeholder.filled ? (
            <CheckCircle2 className="h-5 w-5 text-primary" />
          ) : (
            <Circle className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="font-medium">{placeholder.name}</h4>
            <Badge variant={placeholder.filled ? "default" : "secondary"}>
              {placeholder.filled ? "Completed" : "Pending"}
            </Badge>
          </div>
          {placeholder.description && (
            <p className="text-sm text-muted-foreground">{placeholder.description}</p>
          )}
          {placeholder.value && (
            <p className="text-sm font-mono bg-muted p-2 rounded">
              {placeholder.value}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
};
