import { useEffect, useState, type ReactNode } from 'react';
import { Printer } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { DocTitleScope } from '@/store/docTitleStore';
import {
  DocTitlePicker, initialDocTitleChoice, resolvedDocTitle, resolvedPeriodPrefix, type DocTitleChoice,
} from './DocTitlePicker';

/** Ce que l'operateur a choisi : titre de l'en-tete et texte devant les dates. */
export interface PrintTitles {
  title: string;
  periodPrefix: string;
  /** Texte libre imprime a la fin du document. */
  endText: string;
}

/** Une demande d'impression en attente du choix du titre. */
export interface PrintTitleRequest {
  defaultTitle: string;
  defaultPeriodPrefix?: string;
  /** « DU 01/09/2026 AU 25/09/2026 » — absent quand le document n'a pas de periode. */
  periodSuffix?: string;
  scope: DocTitleScope;
  dialogTitle?: string;
  /** Contenu supplementaire affiche au-dessus du choix du titre. */
  extra?: () => ReactNode;
  print: (titles: PrintTitles) => void;
}

/**
 * Fenetre « Imprimer » des ecrans qui imprimaient directement (rapport
 * general, historiques, bon de livraison) : on choisit le titre, puis on
 * imprime.
 */
export function PrintTitleDialog({ request, onClose }: { request: PrintTitleRequest | null; onClose: () => void }) {
  const [choice, setChoice] = useState<DocTitleChoice>(() => initialDocTitleChoice(''));

  useEffect(() => {
    if (request) setChoice(initialDocTitleChoice(request.defaultTitle, request.defaultPeriodPrefix));
  }, [request]);

  if (!request) return null;
  const fallbackPrefix = request.defaultPeriodPrefix ?? request.defaultTitle;

  return (
    <Modal open={!!request} onClose={onClose} title={request.dialogTitle ?? 'Imprimer'} size="md">
      <div className="space-y-4">
        {request.extra?.()}
        <DocTitlePicker
          value={choice}
          onChange={setChoice}
          defaultTitle={request.defaultTitle}
          defaultPeriodPrefix={request.defaultPeriodPrefix}
          periodSuffix={request.periodSuffix}
          scope={request.scope}
        />
        <div className="flex gap-2 border-t border-gold/15 pt-4">
          <Button variant="secondary" className="flex-1" onClick={onClose}>Annuler</Button>
          <Button
            variant="gold"
            className="flex-1 font-bold"
            onClick={() => {
              const titles = {
                title: resolvedDocTitle(choice, request.defaultTitle),
                periodPrefix: resolvedPeriodPrefix(choice, fallbackPrefix),
                endText: choice.endText.trim(),
              };
              onClose();
              request.print(titles);
            }}
          >
            <Printer size={16} /> Imprimer
          </Button>
        </div>
      </div>
    </Modal>
  );
}
