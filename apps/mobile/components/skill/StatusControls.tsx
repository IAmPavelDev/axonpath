import { Button } from '@atomics/button';
import { Text } from '@atomics/text';
import { SettableSkillStatus } from '@/types/skill';
import { FC } from 'react';
import { View } from 'react-native';

/** Chip text for the non-default statuses; ACTIVE keeps the plain rendering. */
const CHIP_LABEL: Partial<Record<string, string>> = {
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

/**
 * Dumb client-side copy of the user-settable transition whitelist: only the
 * targets legal from the current status are offered (GENERATING/FAILED are
 * machine-managed phases with their own UI, so no actions appear there).
 * The server re-validates against the same state machine.
 */
const NEXT_ACTIONS: Partial<
  Record<string, { status: SettableSkillStatus; label: string }[]>
> = {
  ACTIVE: [
    { status: 'PAUSED', label: 'Pause' },
    { status: 'COMPLETED', label: 'Mark completed' },
    { status: 'ARCHIVED', label: 'Archive' },
  ],
  PAUSED: [
    { status: 'ACTIVE', label: 'Resume' },
    { status: 'COMPLETED', label: 'Mark completed' },
    { status: 'ARCHIVED', label: 'Archive' },
  ],
  COMPLETED: [{ status: 'ARCHIVED', label: 'Archive' }],
};

/**
 * Status chip + lifecycle actions for the skill detail header. Rendered only
 * when there is something to show; ARCHIVED shows the chip with no actions
 * (terminal — the skill stays reachable by deep link).
 */
export const StatusControls: FC<{
  status: string;
  disabled: boolean;
  onSetStatus: (status: SettableSkillStatus) => void;
}> = ({ status, disabled, onSetStatus }) => {
  const chip = CHIP_LABEL[status];
  const actions = NEXT_ACTIONS[status] ?? [];

  if (!chip && actions.length === 0) {
    return null;
  }

  return (
    <View className="gap-2">
      {chip && (
        <View className="self-start rounded-full border border-border px-3 py-1">
          <Text variant="label">{chip}</Text>
        </View>
      )}
      {actions.length > 0 && (
        <View className="flex-row flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action.status}
              variant="outline"
              size="sm"
              disabled={disabled}
              onPress={() => onSetStatus(action.status)}
            >
              <Text>{action.label}</Text>
            </Button>
          ))}
        </View>
      )}
    </View>
  );
};
