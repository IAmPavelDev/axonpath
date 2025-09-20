import React from 'react';
import { Dimensions } from 'react-native';

export const useDimensions = () => {
  const [dimensions, setDimensions] = React.useState<{
    width: number;
    height: number;
    screenWidth: number;
    screenHeight: number;
  }>({ width: 0, height: 0, screenWidth: 0, screenHeight: 0 });

  React.useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        width: Dimensions.get('window').width,
        height: Dimensions.get('window').height,
        screenWidth: Dimensions.get('screen').width,
        screenHeight: Dimensions.get('screen').height,
      });
    };

    const subscription = Dimensions.addEventListener('change', updateDimensions);

    updateDimensions();

    return subscription.remove;
  }, []);

  return dimensions;
};
