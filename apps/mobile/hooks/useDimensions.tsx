import React from 'react';
import { Dimensions } from 'react-native';

export const useDimensions = () => {
  const [dimensions, setDimensions] = React.useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });

  React.useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: Dimensions.get('window').width,
        height: Dimensions.get('window').height,
      });
    };

    const subscription = Dimensions.addEventListener('change', updateDimensions);

    updateDimensions();

    return subscription.remove;
  }, []);

  return dimensions;
};
