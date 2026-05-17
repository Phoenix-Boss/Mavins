import React, { createContext, useContext, useState, PropsWithChildren } from 'react';
import Animated from 'react-native-reanimated'; // Assuming reanimated for better perf, but can use react-native Animated

type NavigationAnimationContextType = {
  scrollY: Animated.Value;
  setScrollY: (value: Animated.Value) => void;
  tabVisible: boolean;
  setTabVisible: (value: boolean) => void;
};

const NavigationAnimationContext = createContext<NavigationAnimationContextType>({
  scrollY: new Animated.Value(0),
  setScrollY: () => {},
  tabVisible: false,
  setTabVisible: () => {},
});

export const NavigationAnimationProvider = ({ children }: PropsWithChildren) => {
  const [scrollY, setScrollY] = useState(new Animated.Value(0));
  const [tabVisible, setTabVisible] = useState(false);

  return (
    <NavigationAnimationContext.Provider value={{ scrollY, setScrollY, tabVisible, setTabVisible }}>
      {children}
    </NavigationAnimationContext.Provider>
  );
};

export const useNavigationAnimation = () => useContext(NavigationAnimationContext);
