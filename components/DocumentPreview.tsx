import { DocumentState } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText } from "lucide-react";

interface DocumentPreviewProps {
  document: DocumentState;
  onDownload?: () => void;
}

export const DocumentPreview = ({ document, onDownload }: DocumentPreviewProps) => {
  const completionPercentage = Math.round(
    (document.placeholders.filter(p => p.filled).length / document.placeholders.length) * 100
  );

  return (
    <Card className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">{document.fileName}</h3>
            <p className="text-sm text-muted-foreground">
              {document.completed ? "Completed" : `${completionPercentage}% complete`}
            </p>
          </div>
        </div>
        {document.completed && (
          <Button onClick={onDownload} variant="default">
            <Download className="h-4 w-4 mr-2" />
            Download
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-medium">{completionPercentage}%</span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>
      </div>

    </Card>
  );
};
