import type { TroubleshootResponse } from '../../../shared/api';
import { IncidentRail } from './IncidentRail';
import { PlaybookStage } from './PlaybookStage';

interface ResultCardProps {
  result: TroubleshootResponse;
}

export function ResultCard({ result }: ResultCardProps) {
  return (
    <div class="incident-workbench">
      <IncidentRail result={result} />
      <PlaybookStage result={result} />
    </div>
  );
}
