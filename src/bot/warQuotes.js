// Broadcast when a tied restart vote's d20 roll comes up 1-10 (stand down).
const WAR_QUOTES = [
  { quote: 'War is hell.', author: 'William Tecumseh Sherman' },
  { quote: 'In war, truth is the first casualty.', author: 'Aeschylus' },
  { quote: 'The object of war is not to die for your country but to make the other bastard die for his.', author: 'George S. Patton' },
  { quote: 'All warfare is based on deception.', author: 'Sun Tzu' },
  { quote: 'War is the continuation of politics by other means.', author: 'Carl von Clausewitz' },
  { quote: 'I came, I saw, I conquered.', author: 'Julius Caesar' },
  { quote: 'Give me liberty, or give me death!', author: 'Patrick Henry' },
  { quote: 'We shall fight on the beaches, we shall fight on the landing grounds, we shall fight in the fields and in the streets, we shall fight in the hills; we shall never surrender.', author: 'Winston Churchill' },
  { quote: 'It is well that war is so terrible, or we should grow too fond of it.', author: 'Robert E. Lee' },
  { quote: 'Old soldiers never die, they just fade away.', author: 'Douglas MacArthur' },
  { quote: 'The supreme art of war is to subdue the enemy without fighting.', author: 'Sun Tzu' },
  { quote: 'War does not determine who is right — only who is left.', author: 'Bertrand Russell' },
  { quote: "Cry 'Havoc!' and let slip the dogs of war.", author: 'William Shakespeare' },
  { quote: "May God have mercy for my enemies, because I won't.", author: 'George S. Patton' },
  { quote: 'Nothing except a battle lost can be half so melancholy as a battle won.', author: 'Duke of Wellington' },
  { quote: 'The battle, sir, is not to the strong alone; it is to the vigilant, the active, the brave.', author: 'Patrick Henry' },
  { quote: 'There is nothing so likely to produce peace as to be well prepared to meet an enemy.', author: 'George Washington' },
  { quote: 'Whoever desires peace should prepare for war.', author: 'Vegetius' },
  { quote: 'A soldier will fight long and hard for a bit of colored ribbon.', author: 'Napoleon Bonaparte' },
  { quote: 'You may not be interested in war, but war is interested in you.', author: 'Leon Trotsky' },
]

export function randomWarQuote() {
  const q = WAR_QUOTES[Math.floor(Math.random() * WAR_QUOTES.length)]
  return `"${q.quote}" — ${q.author}`
}
