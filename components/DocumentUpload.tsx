import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Card } from "@/components/ui/card";
import { FileText, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface DocumentUploadProps {
  onUpload: (file: File) => void;
  disabled?: boolean;
}

export const DocumentUpload = ({ onUpload, disabled = false }: DocumentUploadProps) => {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0 && !disabled) {
      onUpload(acceptedFiles[0]);
    }
  }, [onUpload, disabled]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/msword': ['.doc']
    },
    multiple: false,
    disabled
  });

  return (
    <Card
      {...getRootProps()}
      className={cn(
        "border-2 border-dashed transition-all cursor-pointer",
        "hover:border-primary hover:bg-accent/50",
        isDragActive && "border-primary bg-accent/50",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <input {...getInputProps()} />
      <div className="flex flex-col items-center justify-center gap-4 p-12">
        <div className="rounded-full bg-primary/10 p-4">
          {isDragActive ? (
            <Upload className="h-8 w-8 text-primary animate-bounce" />
          ) : (
            <FileText className="h-8 w-8 text-primary" />
          )}
        </div>
        <div className="text-center space-y-2">
          <p className="text-lg font-medium">
            {isDragActive ? "Drop your document here" : "Upload Legal Document"}
          </p>
          <p className="text-sm text-muted-foreground">
            Drag and drop your .docx file or click to browse
          </p>
        </div>
      </div>
    </Card>
  );
};
