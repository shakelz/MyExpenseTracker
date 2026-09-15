import React, { ReactNode, useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions, ViewStyle } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

type DraggableSnapBubbleProps = {
  size?: number;
  isOpen?: boolean;
  onPress: () => void;
  initialPosition?: { x: number; y: number };
  bubbleStyle?: ViewStyle;
  bubbleContent?: ReactNode;
  children?: ReactNode;
};

const DEFAULT_SIZE = 56;
const DEFAULT_MARGIN = 16;

const clamp = (value: number, min: number, max: number) => {
  'worklet';
  return Math.max(min, Math.min(value, max));
};

export default function DraggableSnapBubble({
  size = DEFAULT_SIZE,
  isOpen = false,
  onPress,
  initialPosition,
  bubbleStyle,
  bubbleContent,
  children,
}: DraggableSnapBubbleProps) {
  const { width, height } = useWindowDimensions();

  const initialBounds = useMemo(
    () => ({
      minX: DEFAULT_MARGIN,
      maxX: Math.max(DEFAULT_MARGIN, width - size - DEFAULT_MARGIN),
      minY: DEFAULT_MARGIN + 32,
      maxY: Math.max(DEFAULT_MARGIN + 32, height - size - DEFAULT_MARGIN),
    }),
    [height, size, width],
  );

  const bounds = useSharedValue(initialBounds);

  const initialX = initialPosition?.x ?? initialBounds.maxX;
  const initialY = initialPosition?.y ?? height * 0.55;

  const translateX = useSharedValue(initialX);
  const translateY = useSharedValue(initialY);

  useEffect(() => {
    bounds.value = {
      minX: DEFAULT_MARGIN,
      maxX: Math.max(DEFAULT_MARGIN, width - size - DEFAULT_MARGIN),
      minY: DEFAULT_MARGIN + 32,
      maxY: Math.max(DEFAULT_MARGIN + 32, height - size - DEFAULT_MARGIN),
    };

    translateX.value = clamp(
      initialPosition?.x ?? translateX.value,
      bounds.value.minX,
      bounds.value.maxX,
    );
    translateY.value = clamp(
      initialPosition?.y ?? translateY.value,
      bounds.value.minY,
      bounds.value.maxY,
    );
  }, [bounds, height, initialPosition, size, translateX, translateY, width]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
    ],
  }));

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const hasMoved = useSharedValue(false);

  const TAP_SLOP = 5;

  const panGesture = Gesture.Pan()
    .enabled(!isOpen)
    .onBegin(() => {
      startX.value = clamp(translateX.value, bounds.value.minX, bounds.value.maxX);
      startY.value = clamp(translateY.value, bounds.value.minY, bounds.value.maxY);
      translateX.value = startX.value;
      translateY.value = startY.value;
      hasMoved.value = false;
    })
    .onUpdate(event => {
      if (
        Math.abs(event.translationX) > TAP_SLOP ||
        Math.abs(event.translationY) > TAP_SLOP
      ) {
        hasMoved.value = true;
      }
      translateX.value = clamp(
        startX.value + event.translationX,
        bounds.value.minX,
        bounds.value.maxX,
      );
      translateY.value = clamp(
        startY.value + event.translationY,
        bounds.value.minY,
        bounds.value.maxY,
      );
    })
    .onEnd(event => {
      const isTap =
        !hasMoved.value &&
        Math.abs(event.translationX) < TAP_SLOP &&
        Math.abs(event.translationY) < TAP_SLOP;
      if (isTap) {
        runOnJS(onPress)();
      }
      const snapToLeft = translateX.value + size / 2 < width / 2;
      const targetX = snapToLeft ? bounds.value.minX : bounds.value.maxX;
      translateX.value = withSpring(targetX, {
        damping: 18,
        stiffness: 180,
      });
    });

  return (
    <View style={styles.layer} pointerEvents="box-none">
      {children}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[
            styles.bubble,
            { width: size, height: size },
            animatedStyle,
            bubbleStyle,
          ]}
        >
          <View style={styles.bubbleContent}>
            {bubbleContent ?? <View style={styles.defaultDot} />}
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
  },
  bubble: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: '#4E7CFF',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
    shadowColor: '#000000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  bubbleContent: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  defaultDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
});
