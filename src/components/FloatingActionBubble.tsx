import React, { ReactNode, useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const DEFAULT_SIZE = 56;
const DEFAULT_MARGIN = 16;
const TAP_SLOP = 5;
const EXPANDED_RADIUS = 24;

type FloatingActionBubbleProps = {
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  size?: number;
  children: ReactNode;
};

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

type FormLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const clamp = (value: number, min: number, max: number) => {
  'worklet';
  return Math.max(min, Math.min(value, max));
};

export default function FloatingActionBubble({
  isOpen,
  onOpen,
  onClose,
  size = DEFAULT_SIZE,
  children,
}: FloatingActionBubbleProps) {
  const { width, height } = useWindowDimensions();

  const initialBounds = useMemo<Bounds>(
    () => ({
      minX: DEFAULT_MARGIN,
      maxX: Math.max(DEFAULT_MARGIN, width - size - DEFAULT_MARGIN),
      minY: DEFAULT_MARGIN + 32,
      maxY: Math.max(DEFAULT_MARGIN + 32, height - size - DEFAULT_MARGIN),
    }),
    [height, size, width],
  );

  const initialFormLayout = useMemo<FormLayout>(() => {
    const formWidth = Math.min(width - 32, 420);
    const formHeight = Math.min(height * 0.85, 680);
    const formX = (width - formWidth) / 2;
    const formY = Math.max(24, height * 0.08);
    return { x: formX, y: formY, width: formWidth, height: formHeight };
  }, [height, width]);

  const bounds = useSharedValue<Bounds>(initialBounds);
  const formLayout = useSharedValue<FormLayout>(initialFormLayout);

  const bubbleX = useSharedValue(initialBounds.maxX);
  const bubbleY = useSharedValue(height * 0.55);

  const containerX = useSharedValue(initialBounds.maxX);
  const containerY = useSharedValue(height * 0.55);
  const containerW = useSharedValue(size);
  const containerH = useSharedValue(size);
  const containerRadius = useSharedValue(size / 2);

  const bubbleOpacity = useSharedValue(1);
  const contentOpacity = useSharedValue(0);
  const backdropOpacity = useSharedValue(0);

  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const hasMoved = useSharedValue(false);

  useEffect(() => {
    bounds.value = {
      minX: DEFAULT_MARGIN,
      maxX: Math.max(DEFAULT_MARGIN, width - size - DEFAULT_MARGIN),
      minY: DEFAULT_MARGIN + 32,
      maxY: Math.max(DEFAULT_MARGIN + 32, height - size - DEFAULT_MARGIN),
    };
    formLayout.value = initialFormLayout;

    bubbleX.value = clamp(bubbleX.value, bounds.value.minX, bounds.value.maxX);
    bubbleY.value = clamp(bubbleY.value, bounds.value.minY, bounds.value.maxY);

    if (!isOpen) {
      containerX.value = bubbleX.value;
      containerY.value = bubbleY.value;
      containerW.value = size;
      containerH.value = size;
      containerRadius.value = size / 2;
    }
  }, [bounds, bubbleX, bubbleY, containerH, containerRadius, containerW, containerX, containerY, formLayout, initialFormLayout, isOpen, size, width, height]);

  useEffect(() => {
    if (isOpen) {
      containerX.value = withSpring(formLayout.value.x, { damping: 22, stiffness: 180 });
      containerY.value = withSpring(formLayout.value.y, { damping: 22, stiffness: 180 });
      containerW.value = withSpring(formLayout.value.width, { damping: 22, stiffness: 180 });
      containerH.value = withSpring(formLayout.value.height, { damping: 22, stiffness: 180 });
      containerRadius.value = withSpring(EXPANDED_RADIUS, { damping: 22, stiffness: 180 });
      bubbleOpacity.value = withTiming(0.15, { duration: 150 });
      contentOpacity.value = withTiming(1, { duration: 220 });
      backdropOpacity.value = withTiming(0.25, { duration: 200 });
      return;
    }

    containerX.value = withSpring(bubbleX.value, { damping: 22, stiffness: 180 });
    containerY.value = withSpring(bubbleY.value, { damping: 22, stiffness: 180 });
    containerW.value = withSpring(size, { damping: 22, stiffness: 180 });
    containerH.value = withSpring(size, { damping: 22, stiffness: 180 });
    containerRadius.value = withSpring(size / 2, { damping: 22, stiffness: 180 });
    bubbleOpacity.value = withTiming(1, { duration: 150 });
    contentOpacity.value = withTiming(0, { duration: 120 });
    backdropOpacity.value = withTiming(0, { duration: 150 });
  }, [bubbleOpacity, bubbleX, bubbleY, containerH, containerRadius, containerW, containerX, containerY, contentOpacity, backdropOpacity, formLayout, isOpen, size]);

  const panGesture = Gesture.Pan()
    .enabled(!isOpen)
    .onBegin(() => {
      startX.value = bubbleX.value;
      startY.value = bubbleY.value;
      hasMoved.value = false;
    })
    .onUpdate(event => {
      if (
        Math.abs(event.translationX) > TAP_SLOP ||
        Math.abs(event.translationY) > TAP_SLOP
      ) {
        hasMoved.value = true;
      }
      bubbleX.value = clamp(
        startX.value + event.translationX,
        bounds.value.minX,
        bounds.value.maxX,
      );
      bubbleY.value = clamp(
        startY.value + event.translationY,
        bounds.value.minY,
        bounds.value.maxY,
      );
      containerX.value = bubbleX.value;
      containerY.value = bubbleY.value;
    })
    .onEnd(event => {
      const isTap =
        !hasMoved.value &&
        Math.abs(event.translationX) < TAP_SLOP &&
        Math.abs(event.translationY) < TAP_SLOP;
      if (isTap) {
        runOnJS(onOpen)();
        return;
      }
      const snapToLeft = bubbleX.value + size / 2 < width / 2;
      const targetX = snapToLeft ? bounds.value.minX : bounds.value.maxX;
      bubbleX.value = withSpring(targetX, { damping: 18, stiffness: 180 });
      containerX.value = withSpring(targetX, { damping: 18, stiffness: 180 });
    });

  const containerStyle = useAnimatedStyle(() => ({
    width: containerW.value,
    height: containerH.value,
    borderRadius: containerRadius.value,
    transform: [
      { translateX: containerX.value },
      { translateY: containerY.value },
    ],
  }));

  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: bubbleOpacity.value,
    transform: [{ translateY: bubbleOpacity.value < 1 ? 6 : 0 }],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  return (
    <View style={styles.layer} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents="none" />
      {isOpen && (
        <Pressable style={styles.backdropPressable} onPress={onClose} />
      )}
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.container, containerStyle]}>
          <Animated.View
            style={[styles.bubbleIcon, { width: size, height: size, borderRadius: size / 2 }, bubbleStyle]}
          />
          <Animated.View
            style={[styles.content, contentStyle]}
            pointerEvents={isOpen ? 'auto' : 'none'}
          >
            {children}
          </Animated.View>
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
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0B0F1A',
  },
  backdropPressable: {
    ...StyleSheet.absoluteFillObject,
  },
  container: {
    position: 'absolute',
    backgroundColor: 'transparent',
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  bubbleIcon: {
    backgroundColor: '#4E7CFF',
    position: 'absolute',
    top: 0,
    left: 0,
  },
  content: {
    flex: 1,
  },
});
