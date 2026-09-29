import { Button } from '@atomics/button';
import { Sparkles } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from 'react-native';
import { Text } from '@atomics/text';

type Props = {
  visible: boolean;
  /** Preview of the anchored conspect chunk, shown as the sheet's context. */
  excerpt: string | null;
  onClose: () => void;
  /** Called with the trimmed, validated question. */
  onSubmit: (question: string) => void;
};

const MAX_LEN = 4000;

/**
 * Bottom sheet composer for anchored questions. The keyboard lives in the
 * sheet (the document above stays untouched); Enter submits (chat-style) and
 * the "Ask AI" button is the tap target. Submit hands the question to the
 * parent, which closes the sheet and inserts the optimistic block.
 */
export function QaComposer({ visible, excerpt, onClose, onSubmit }: Props) {
  const [text, setText] = useState('');

  // Fresh sheet per open.
  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const trimmed = text.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= MAX_LEN;
  const submit = () => {
    if (!valid) return;
    onSubmit(trimmed);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View className="flex-1 justify-end bg-black/40">
        <Pressable
          className="absolute inset-0"
          onPress={onClose}
          accessibilityLabel="Close question composer"
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View className="rounded-t-2xl bg-card px-5 pb-8 pt-3">
            <View className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />

            {excerpt ? (
              <Text
                numberOfLines={2}
                className="mb-3 font-sans-medium text-[13px] leading-[18px] text-muted-foreground"
              >
                Anchored to: “{excerpt}”
              </Text>
            ) : null}

            <TextInput
              autoFocus
              multiline
              value={text}
              onChangeText={setText}
              onSubmitEditing={submit}
              submitBehavior="blurAndSubmit"
              enterKeyHint="send"
              maxLength={MAX_LEN}
              placeholder="Ask the AI about this passage…"
              placeholderTextColor="hsl(215 19% 35%)"
              textAlignVertical="top"
              accessibilityLabel="Your question"
              className="min-h-[92px] rounded-lg bg-muted px-3 py-2.5 font-sans text-[16px] leading-[24px] text-foreground"
            />

            <View className="mt-3 flex-row items-center justify-between">
              <Text className="font-sans text-[12px] text-muted-foreground">
                {text.length}/{MAX_LEN}
              </Text>
              <Button size="sm" onPress={submit} disabled={!valid}>
                <Sparkles size={14} color="hsl(0 0% 100%)" />
                <Text className="font-sans-semibold text-[14px] text-primary-foreground">
                  Ask AI
                </Text>
              </Button>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
