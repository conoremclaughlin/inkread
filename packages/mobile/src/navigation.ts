export type RootStackParamList = {
  Login: undefined;
  Library: undefined;
  Reader: { bookId: string; title: string };
  Notes: { bookId: string; title: string };
};
