export type RootStackParamList = {
  Login: undefined;
  Library: undefined;
  Discover: undefined;
  Series: { bookId: string; title: string };
  Reader: { bookId: string; title: string };
  Notes: { bookId: string; title: string };
};
