"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClassesBulk } from "@/lib/actions/classes";
import { listProjectDatasetsBrief } from "@/lib/actions/project-drop";
import {
  classifyDroppedFiles,
  readFileAsText,
} from "@/lib/upload/classify-files";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ImageIcon, Box, Tags, Upload } from "lucide-react";

type DropKind = "images" | "model" | "classes";

interface PendingDrop {
  kind: DropKind;
  files: File[];
}

interface ProjectDropContextValue {
  consumePending: (kind: DropKind) => File[] | null;
  registerHandler: (kind: DropKind, handler: (files: File[]) => void) => () => void;
}

const ProjectDropContext = createContext<ProjectDropContextValue | null>(null);

export function useProjectDrop() {
  return useContext(ProjectDropContext);
}

export function ProjectDropProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [dragging, setDragging] = useState(false);
  const depthRef = useRef(0);
  const [pending, setPending] = useState<PendingDrop | null>(null);
  const [modal, setModal] = useState<{
    kind: DropKind;
    files: File[];
    datasets: { id: string; name: string }[];
    selectedDatasetId: string;
    error: string | null;
    loading: boolean;
  } | null>(null);

  const handlersRef = useRef<Map<DropKind, (files: File[]) => void>>(new Map());
  const pendingRef = useRef<PendingDrop | null>(null);

  const registerHandler = useCallback(
    (kind: DropKind, handler: (files: File[]) => void) => {
      handlersRef.current.set(kind, handler);
      return () => {
        handlersRef.current.delete(kind);
      };
    },
    []
  );

  const consumePending = useCallback((kind: DropKind): File[] | null => {
    const current = pendingRef.current;
    if (!current || current.kind !== kind) return null;
    pendingRef.current = null;
    setPending(null);
    return current.files;
  }, []);

  const dispatchToHandler = useCallback((kind: DropKind, files: File[]) => {
    const handler = handlersRef.current.get(kind);
    if (handler) {
      handler(files);
      return true;
    }
    return false;
  }, []);

  const importClassFiles = useCallback(
    async (files: File[]) => {
      const parts = await Promise.all(files.map((f) => readFileAsText(f)));
      const text = parts.join("\n");
      const fd = new FormData();
      fd.set("names", text);
      const result = await createClassesBulk(projectId, fd);
      if (result?.error) {
        setModal((m) => (m ? { ...m, error: result.error!, loading: false } : m));
        return;
      }
      setModal(null);
      router.refresh();
      if (!pathname.includes("/classes")) {
        router.push(`/projects/${projectId}/classes`);
      }
    },
    [pathname, projectId, router]
  );

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (!files.length) return;

      const { images, models, classFiles } = classifyDroppedFiles(files);

      if (images.length > 0) {
        if (dispatchToHandler("images", images)) return;

        const match = pathname.match(
          /\/projects\/[^/]+\/datasets\/([^/]+)\/upload/
        );
        if (match) return;

        const res = await listProjectDatasetsBrief(projectId);
        if (res.datasets.length === 0) {
          setModal({
            kind: "images",
            files: images,
            datasets: [],
            selectedDatasetId: "",
            error: "Create a dataset first, then drop images again.",
            loading: false,
          });
          return;
        }

        setModal({
          kind: "images",
          files: images,
          datasets: res.datasets,
          selectedDatasetId: res.datasets[0].id,
          error: null,
          loading: false,
        });
        return;
      }

      if (models.length > 0) {
        if (dispatchToHandler("model", models)) return;

        pendingRef.current = { kind: "model", files: models };
        setPending({ kind: "model", files: models });
        router.push(`/projects/${projectId}/models/upload`);
        return;
      }

      if (classFiles.length > 0) {
        if (dispatchToHandler("classes", classFiles)) return;
        await importClassFiles(classFiles);
        return;
      }
    },
    [dispatchToHandler, importClassFiles, pathname, projectId, router]
  );

  useEffect(() => {
    function onDragEnter(e: DragEvent) {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      depthRef.current += 1;
      setDragging(true);
    }

    function onDragLeave(e: DragEvent) {
      e.preventDefault();
      depthRef.current -= 1;
      if (depthRef.current <= 0) {
        depthRef.current = 0;
        setDragging(false);
      }
    }

    function onDragOver(e: DragEvent) {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }

    function onDrop(e: DragEvent) {
      e.preventDefault();
      depthRef.current = 0;
      setDragging(false);
      if (e.dataTransfer?.files?.length) {
        void handleFiles(e.dataTransfer.files);
      }
    }

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleFiles]);

  async function confirmImageUpload() {
    if (!modal || modal.kind !== "images" || !modal.selectedDatasetId) return;
    setModal({ ...modal, loading: true, error: null });
    pendingRef.current = { kind: "images", files: modal.files };
    setPending({ kind: "images", files: modal.files });
    setModal(null);
    router.push(
      `/projects/${projectId}/datasets/${modal.selectedDatasetId}/upload`
    );
  }

  const kindMeta: Record<
    DropKind,
    { icon: typeof ImageIcon; title: string; color: string }
  > = {
    images: { icon: ImageIcon, title: "Images", color: "text-green-600" },
    model: { icon: Box, title: "Model", color: "text-amber-600" },
    classes: { icon: Tags, title: "Classes", color: "text-purple-600" },
  };

  return (
    <ProjectDropContext.Provider value={{ consumePending, registerHandler }}>
      {children}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center bg-brand-600/15 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-brand-500 bg-white px-10 py-8 text-center shadow-xl">
            <Upload className="mx-auto h-12 w-12 text-brand-600" />
            <p className="mt-3 text-lg font-semibold text-slate-900">
              Drop files to upload
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Images → dataset · .pt/.onnx → model · .txt/.json → classes
            </p>
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              {(() => {
                const Meta = kindMeta[modal.kind];
                const Icon = Meta.icon;
                return (
                  <>
                    <Icon className={`h-8 w-8 ${Meta.color}`} />
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        {modal.files.length} {Meta.title.toLowerCase()} file
                        {modal.files.length !== 1 ? "s" : ""} dropped
                      </h3>
                      <p className="text-sm text-slate-500">Choose where to add them</p>
                    </div>
                  </>
                );
              })()}
            </div>

            {modal.error && (
              <div className="mb-4">
                <Alert variant="error">{modal.error}</Alert>
              </div>
            )}

            {modal.kind === "images" && modal.datasets.length > 0 && (
              <div className="mb-4">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Upload to dataset
                </label>
                <select
                  value={modal.selectedDatasetId}
                  onChange={(e) =>
                    setModal({ ...modal, selectedDatasetId: e.target.value })
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                >
                  {modal.datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setModal(null)}
                disabled={modal.loading}
              >
                Cancel
              </Button>
              {modal.kind === "images" && modal.datasets.length > 0 && (
                <Button onClick={confirmImageUpload} loading={modal.loading}>
                  {modal.loading ? "Opening…" : "Continue"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </ProjectDropContext.Provider>
  );
}
