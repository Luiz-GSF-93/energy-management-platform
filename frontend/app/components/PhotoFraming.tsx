"use client";
import { useEffect, useRef, useState } from "react";
import {
  AvatarPlacement,
  avatarFrame,
  initialPlacement,
} from "@/app/lib/avatar-frame";
import { Alert, Button, Input } from "./ui";

export default function PhotoFraming({
  source,
  onApply,
  onClose,
}: {
  source: string;
  onApply: (photo: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    image = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [placement, setPlacement] = useState<AvatarPlacement>(initialPlacement);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let disposed = false;
    const photo = new Image();
    photo.onload = () => {
      if (disposed) return;
      if (
        !photo.naturalWidth ||
        !photo.naturalHeight ||
        photo.naturalWidth * photo.naturalHeight > 40000000
      ) {
        setError("A imagem é muito grande ou inválida.");
        return;
      }
      image.current = photo;
      setLoaded(true);
    };
    photo.onerror = () => {
      if (!disposed)
        setError("Não foi possível abrir esta foto. Selecione outra imagem.");
    };
    photo.src = source;
    return () => {
      disposed = true;
      image.current = null;
    };
  }, [source]);
  useEffect(() => {
    const target = canvas.current,
      photo = image.current;
    if (!loaded || !target || !photo) return;
    const ctx = target.getContext("2d");
    if (!ctx) {
      setLoaded(false);
      setError("Não foi possível preparar esta foto. Selecione outra imagem.");
      return;
    }
    const frame = avatarFrame(
      photo.naturalWidth,
      photo.naturalHeight,
      placement,
    );
    ctx.clearRect(0, 0, 128, 128);
    ctx.drawImage(photo, frame.left, frame.top, frame.width, frame.height);
  }, [loaded, placement]);
  function apply() {
    if (!loaded || !canvas.current || !image.current) return;
    const photo = canvas.current.toDataURL("image/png");
    if (photo.length > 80000) {
      setError("Não foi possível preparar esta foto. Selecione outra imagem.");
      return;
    }
    onApply(photo);
  }
  function change(key: keyof AvatarPlacement, value: number) {
    setPlacement((p) => ({ ...p, [key]: value }));
  }
  return (
    <dialog
      ref={dialog}
      className="environment-photo-dialog"
      aria-labelledby="photo-framing-title"
      onCancel={onClose}
    >
      <header className="environment-photo-dialog-header">
        <h2 id="photo-framing-title">Ajustar foto</h2>
        <Button type="button" variant="secondary" onClick={onClose}>
          Fechar
        </Button>
      </header>
      <p>
        A prévia mostra o mesmo enquadramento do avatar. Ajuste o tamanho e a
        posição antes de aplicar.
      </p>
      {error ? <Alert>{error}</Alert> : null}
      {!loaded && !error ? <p>Preparando foto…</p> : null}
      <canvas
        ref={canvas}
        width={128}
        height={128}
        className="environment-photo-canvas"
        role="img"
        aria-label="Prévia circular do enquadramento da foto"
      />
      <div className="environment-photo-controls">
        <Input
          label="Tamanho da foto"
          type="range"
          min={1}
          max={4}
          step={0.05}
          value={placement.zoom}
          disabled={!loaded}
          onChange={(e) => change("zoom", Number(e.target.value))}
        />
        <Input
          label="Posição horizontal"
          type="range"
          min={-1}
          max={1}
          step={0.02}
          value={placement.x}
          disabled={!loaded}
          onChange={(e) => change("x", Number(e.target.value))}
        />
        <Input
          label="Posição vertical"
          type="range"
          min={-1}
          max={1}
          step={0.02}
          value={placement.y}
          disabled={!loaded}
          onChange={(e) => change("y", Number(e.target.value))}
        />
      </div>
      <p className="environment-help">
        Para recuperar partes cortadas de uma foto já salva, selecione novamente
        a imagem original. Aplicar prepara a prévia; “Salvar configurações”
        confirma a alteração.
      </p>
      <div className="environment-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={!loaded}
          onClick={() => setPlacement(initialPlacement)}
        >
          Mostrar imagem inteira
        </Button>
        <Button type="button" disabled={!loaded || !!error} onClick={apply}>
          Aplicar enquadramento
        </Button>
      </div>
    </dialog>
  );
}
