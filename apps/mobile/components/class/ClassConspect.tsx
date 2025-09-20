import { Markdown } from 'react-native-markdown-x';
import { FC } from 'react';

export const ClassConspect: FC<{ contentMd: string }> = ({ contentMd }) => {
  return <Markdown>{contentMd}</Markdown>;
};
