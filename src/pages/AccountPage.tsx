import React, { useState } from 'react';
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { useAuth } from '../contexts/AuthContext';
import { updateUser } from '../lib/db-service';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Card, CardContent, CardHeader } from '../components/ui/card';
import toast from 'react-hot-toast';

export function AccountPage() {
  const { firebaseUser, profile } = useAuth();

  const [firstname, setFirstname] = useState(profile?.firstname || '');
  const [lastname, setLastname] = useState(profile?.lastname || '');
  const [tel, setTel] = useState(profile?.tel || '');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    setSavingProfile(true);
    try {
      await updateUser(firebaseUser.uid, {
        firstname: firstname.trim(),
        lastname: lastname.trim(),
        displayName: `${firstname.trim()} ${lastname.trim()}`.trim(),
        tel: tel.trim(),
        updatedAt: new Date().toISOString(),
      });
      toast.success('Profile updated.');
    } catch {
      toast.error('Failed to update profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !firebaseUser.email) return;
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    setChangingPassword(true);
    try {
      const credential = EmailAuthProvider.credential(firebaseUser.email, currentPassword);
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, newPassword);
      toast.success('Password changed.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      toast.error('Current password is incorrect.');
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <main className="flex-1 max-w-2xl mx-auto px-4 sm:px-6 py-10">
      <h1 className="text-2xl font-bold mb-8">Account settings</h1>

      <div className="flex flex-col gap-6">
        {/* Profile */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold">Personal information</h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveProfile} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="First name"
                  value={firstname}
                  onChange={(e) => setFirstname(e.target.value)}
                  placeholder="John"
                  autoComplete="given-name"
                />
                <Input
                  label="Last name"
                  value={lastname}
                  onChange={(e) => setLastname(e.target.value)}
                  placeholder="Doe"
                  autoComplete="family-name"
                />
              </div>
              <Input
                label="Email"
                value={firebaseUser?.email || ''}
                disabled
                className="bg-gray-50"
              />
              <Input
                label="Phone number"
                value={tel}
                onChange={(e) => setTel(e.target.value)}
                placeholder="+250 7XX XXX XXX"
                type="tel"
                autoComplete="tel"
              />
              <div className="flex justify-end">
                <Button type="submit" loading={savingProfile} size="sm">
                  Save changes
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Password */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold">Change password</h2>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
              <Input
                label="Current password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
              <Input
                label="New password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                required
                autoComplete="new-password"
              />
              <Input
                label="Confirm new password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                required
                autoComplete="new-password"
              />
              <div className="flex justify-end">
                <Button type="submit" loading={changingPassword} size="sm">
                  Update password
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Account info */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold">Account</h2>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">User ID</span>
                <span className="font-mono text-xs text-gray-400">{firebaseUser?.uid}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Role</span>
                <span className="font-medium capitalize">{profile?.role || 'user'}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
