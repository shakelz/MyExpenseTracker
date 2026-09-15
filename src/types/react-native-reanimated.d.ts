import type { GestureHandlerGestureEvent } from 'react-native-gesture-handler';

declare module 'react-native-reanimated' {
  export function useAnimatedGestureHandler<
    Event extends GestureHandlerGestureEvent = GestureHandlerGestureEvent,
    Context = Record<string, unknown>
  >(
    handlers: {
      onStart?: (event: Event, context: Context) => void;
      onActive?: (event: Event, context: Context) => void;
      onEnd?: (event: Event, context: Context) => void;
      onFail?: (event: Event, context: Context) => void;
      onCancel?: (event: Event, context: Context) => void;
      onFinish?: (event: Event, context: Context) => void;
    },
  ): (event: Event) => void;
}
