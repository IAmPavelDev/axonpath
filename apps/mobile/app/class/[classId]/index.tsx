import { ClassConspect } from '@components/class/ClassConspect';
import { ScrollView, View } from 'react-native';
import { useClassData } from './_layout';

export default function Route() {
  const classData = useClassData();
  return (
    <ScrollView>
      <View style={{ flex: 1, paddingHorizontal: 16, paddingBottom: 16 }}>
        <ClassConspect contentMd={classData.contentMd} />
      </View>
    </ScrollView>
  );
}
