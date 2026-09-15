import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  ViewStyle,
} from 'react-native';

type FloatingBubbleProps = {
  size?: number;
  isOpen: boolean;
  onPress: () => void;
  initialPosition?: { x: number; y: number };
  style?: ViewStyle;
};

const DEFAULT_SIZE = 58;

export default function FloatingBubble({
  size = DEFAULT_SIZE,
  isOpen,
  onPress,
  initialPosition,
  style,
}: FloatingBubbleProps) {
  const { width, height } = useWindowDimensions();
  const defaultPosition = useMemo(
    () =>
      initialPosition ?? {
        x: width - size - 16,
        y: height * 0.55,
      },
    [height, initialPosition, size, width],
  );

  const position = useRef(new Animated.ValueXY(defaultPosition)).current;
  const lastIdlePosition = useRef(defaultPosition);
  const [isAnimating, setIsAnimating] = useState(false);
  const wasOpenRef = useRef(isOpen);

  useEffect(() => {
    if (!isOpen && wasOpenRef.current) {
      animateTo(lastIdlePosition.current);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (initialPosition) {
      position.setValue(initialPosition);
      lastIdlePosition.current = initialPosition;
    }
  }, [initialPosition, position]);

  const animateTo = (target: { x: number; y: number }, cb?: () => void) => {
    setIsAnimating(true);
    Animated.timing(position, {
      toValue: target,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(() => {
      lastIdlePosition.current = target;
      setIsAnimating(false);
      cb?.();
    });
  };

  const animateToCenter = () => {
    const center = {
      x: Math.max(16, width / 2 - size / 2),
      y: Math.max(80, height / 2 - size / 2),
    };
    animateTo(center, onPress);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !isAnimating && !isOpen,
        onMoveShouldSetPanResponder: () => !isAnimating && !isOpen,
        onPanResponderGrant: () => {
          position.setOffset({
            x: (position.x as any).__getValue(),
            y: (position.y as any).__getValue(),
          });
          position.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: Animated.event(
          [null, { dx: position.x, dy: position.y }],
          { useNativeDriver: false },
        ),
        onPanResponderRelease: () => {
          position.flattenOffset();
          const next = (position as any).__getValue();
          lastIdlePosition.current = next;
        },
      }),
    [isAnimating, isOpen, position],
  );

  return (
    <Animated.View
      style={[
        styles.bubble,
        { width: size, height: size },
        position.getLayout(),
        style,
      ]}
      {...panResponder.panHandlers}
    >
      <Pressable
        onPress={animateToCenter}
        disabled={isAnimating}
        style={styles.pressable}
      >
        <Animated.View style={styles.innerGlow} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: '#4E7CFF',
    elevation: 10,
    shadowColor: '#0F1A3A',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    zIndex: 999,
  },
  pressable: {
    flex: 1,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerGlow: {
    width: '64%',
    height: '64%',
    borderRadius: 999,
    backgroundColor: '#AFC4FF',
    opacity: 0.9,
  },
});
