import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { initAutoFlush } from "./src/api";
import { AuthProvider, useAuth } from "./src/auth";
import { LangProvider } from "./src/i18n";
import { colors } from "./src/theme";
import SignInScreen from "./src/screens/SignInScreen";
import QueueScreen from "./src/screens/QueueScreen";
import JobScreen from "./src/screens/JobScreen";
import ChecklistScreen from "./src/screens/ChecklistScreen";
import CleanupScreen from "./src/screens/CleanupScreen";
import ReportScreen from "./src/screens/ReportScreen";
import SendScreen from "./src/screens/SendScreen";
import PunchListScreen from "./src/screens/PunchListScreen";
import PunchItemScreen from "./src/screens/PunchItemScreen";
import OutboxScreen from "./src/screens/OutboxScreen";

initAutoFlush();

export type RootStackParamList = {
  Queue: undefined;
  Job: { jobId: string };
  Checklist: { jobId: string };
  Cleanup: { jobId: string };
  Report: { jobId: string };
  Send: { jobId: string };
  PunchList: { jobId: string };
  PunchItem: { jobId: string; taskId: string };
  Outbox: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function Root() {
  const { ready, mode } = useAuth();
  if (!ready) return null;
  if (mode === null) return <SignInScreen />;
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="Queue" component={QueueScreen} />
        <Stack.Screen name="Job" component={JobScreen} />
        <Stack.Screen name="Checklist" component={ChecklistScreen} />
        <Stack.Screen name="Cleanup" component={CleanupScreen} />
        <Stack.Screen name="Report" component={ReportScreen} />
        <Stack.Screen name="Send" component={SendScreen} />
        <Stack.Screen name="PunchList" component={PunchListScreen} />
        <Stack.Screen name="PunchItem" component={PunchItemScreen} />
        <Stack.Screen name="Outbox" component={OutboxScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <LangProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <Root />
        </AuthProvider>
      </LangProvider>
    </SafeAreaProvider>
  );
}
